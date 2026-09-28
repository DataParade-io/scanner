/**
 * Candidate line inventory extraction from source code.
 *
 * Matches tokens (e.g., email, sender, recipient) in various naming styles
 * and outputs deterministic YAML with candidate lines for labeling.
 */

import fs from "fs";
import path from "path";

export interface CandidateRecord {
  file: string;
  line: number;
  text: string;
}

export interface CandidatesOutput {
  candidates: CandidateRecord[];
}

/**
 * Split a line into subwords.
 *
 * Splits on every non-alphanumeric character, then splits each piece at camelCase
 * boundaries (lowercase→uppercase, uppercase→lowercase transition at acronym end like
 * HTMLEmail → HTML, Email; digits also break). Lowercases everything and drops empty strings.
 *
 * Example: `last_confirm_email_request = userEmails; FROM_ADDRESS e-mail`
 *   → [last, confirm, email, request, user, emails, from, address, e, mail]
 */
export function splitSubwords(text: string): string[] {
  if (!text) return [];

  // First split on non-alphanumeric characters
  const parts = text.split(/[^a-zA-Z0-9]+/);

  // Then split each part at camelCase boundaries
  const result: string[] = [];
  for (const part of parts) {
    if (!part) continue;

    const subparts: string[] = [];
    let current = "";

    for (let i = 0; i < part.length; i++) {
      const char = part[i];
      const nextChar = part[i + 1];
      const isUpper = /[A-Z]/.test(char);
      const isLower = /[a-z]/.test(char);
      const isDigit = /[0-9]/.test(char);
      const nextIsLower = nextChar && /[a-z]/.test(nextChar);
      const nextIsUpper = nextChar && /[A-Z]/.test(nextChar);

      if (isDigit) {
        // Digit breaks the word
        if (current) {
          subparts.push(current);
          current = "";
        }
      } else if (isUpper && current && (isLower || /[a-z]/.test(current[current.length - 1]))) {
        // Uppercase after lowercase (camelCase boundary)
        subparts.push(current);
        current = char;
      } else if (isLower && current && /[A-Z]/.test(current[current.length - 1]) && current.length > 1) {
        // Lowercase after acronym (acronym→word boundary)
        // "HTML" + "E" + "m" → "html" + "email"
        const lastChar = current[current.length - 1];
        subparts.push(current.slice(0, -1));
        current = lastChar + char;
      } else {
        current += char;
      }
    }

    if (current) {
      subparts.push(current);
    }

    for (const subpart of subparts) {
      if (subpart) {
        result.push(subpart.toLowerCase());
      }
    }
  }

  return result;
}

/**
 * Check if line subwords contain token subwords as consecutive parts,
 * with optional plural suffix (s or es) on the last token part.
 * For multi-part tokens, also accept glued form (e.g., "mailto" for "mail_to").
 */
export function lineContainsToken(line: string, tokenParts: string[][]): boolean {
  const lineWords = splitSubwords(line);

  for (const parts of tokenParts) {
    // Try to match token parts as consecutive subwords
    for (let i = 0; i <= lineWords.length - parts.length; i++) {
      let matches = true;

      for (let j = 0; j < parts.length; j++) {
        const linePart = lineWords[i + j];
        const tokenPart = parts[j];
        const isLastPart = j === parts.length - 1;

        if (isLastPart) {
          // Last part can have plural suffix (s or es)
          if (!(linePart === tokenPart ||
                linePart === tokenPart + "s" ||
                linePart === tokenPart + "es")) {
            matches = false;
            break;
          }
        } else {
          // Non-last parts must match exactly
          if (linePart !== tokenPart) {
            matches = false;
            break;
          }
        }
      }

      if (matches) {
        return true;
      }
    }

    // For multi-part tokens, also try glued form
    if (parts.length > 1) {
      const glued = parts.join("");
      for (let i = 0; i < lineWords.length; i++) {
        const linePart = lineWords[i];
        // Check if glued form with optional plural suffix matches
        if (linePart === glued ||
            linePart === glued + "s" ||
            linePart === glued + "es") {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Get list of source files from scope paths, recursively if they are directories.
 */
export function listScopeFiles(
  scopePaths: string[],
  baseDir: string,
): string[] {
  const allFiles: Set<string> = new Set();

  for (const scopePath of scopePaths) {
    const fullPath = path.join(baseDir, scopePath);

    if (!fs.existsSync(fullPath)) {
      continue;
    }

    const stat = fs.statSync(fullPath);
    if (stat.isFile()) {
      allFiles.add(scopePath);
    } else if (stat.isDirectory()) {
      // Recursively get all files in directory
      const walkDir = (dir: string, prefix: string): void => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const relPath = path.join(prefix, entry.name);
          const fullEntryPath = path.join(dir, entry.name);

          // Skip binary files, minified, node_modules, vendor, dist, build
          if (
            relPath.includes("node_modules") ||
            relPath.includes("vendor") ||
            relPath.includes("/dist") ||
            relPath.includes("/build") ||
            relPath.endsWith(".min.js") ||
            relPath.endsWith(".min.css") ||
            /\.(png|jpg|jpeg|gif|bin|exe|so|dll|dylib)$/i.test(relPath)
          ) {
            continue;
          }

          if (entry.isDirectory()) {
            walkDir(fullEntryPath, relPath);
          } else if (entry.isFile()) {
            // Skip lockfiles
            if (!/^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Gemfile\.lock|composer\.lock)$/i.test(entry.name)) {
              allFiles.add(relPath);
            }
          }
        }
      };

      walkDir(fullPath, scopePath);
    }
  }

  return Array.from(allFiles).sort();
}

/**
 * Extract candidate lines from files that match any token.
 * Tokens are split into subwords and matched against line subwords.
 */
export function extractCandidates(
  tokens: string[],
  repoDir: string,
  files: string[],
): CandidateRecord[] {
  const candidates: CandidateRecord[] = [];
  // Pre-split all tokens into subword parts
  const tokenParts = tokens.map(token => splitSubwords(token));

  for (const file of files) {
    const fullPath = path.join(repoDir, file);

    if (!fs.existsSync(fullPath)) {
      continue;
    }

    try {
      const content = fs.readFileSync(fullPath, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (lineContainsToken(line, tokenParts)) {
          candidates.push({
            file,
            line: i + 1, // 1-based line numbers
            text: line.trim(),
          });
        }
      }
    } catch {
      // Skip files that can't be read (binary, permission issues, etc)
    }
  }

  // Sort by file, then by line
  candidates.sort((a, b) => {
    const fileCmp = a.file.localeCompare(b.file);
    if (fileCmp !== 0) return fileCmp;
    return a.line - b.line;
  });

  return candidates;
}

/**
 * Classify files into test/snapshot/fixture vs production code.
 */
export function classifyFiles(files: string[]): {
  test: string[];
  production: string[];
} {
  const testPatterns = [
    /\btest\b/i,
    /\bspec\b/i,
    /\.test\./,
    /\.spec\./,
    /\.snap$/,
    /__snapshots__/,
    /__tests__/,
    /\/test\//,
    /\/spec\//,
    /\/tests\//,
    /\/fixtures\//,
  ];

  const test: string[] = [];
  const production: string[] = [];

  for (const file of files) {
    const isTest = testPatterns.some((pattern) => pattern.test(file));
    if (isTest) {
      test.push(file);
    } else {
      production.push(file);
    }
  }

  return { test, production };
}

/**
 * Print summary of candidates by file with test/production split.
 */
export function printSummary(candidates: CandidateRecord[]): void {
  // Group by file and count
  const counts: Record<string, number> = {};
  for (const candidate of candidates) {
    counts[candidate.file] = (counts[candidate.file] ?? 0) + 1;
  }

  // Sort by file and print
  const sorted = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  const files = sorted.map(([file]) => file);
  const { test, production } = classifyFiles(files);

  console.log("\nCandidate lines per file:");
  console.log("========================");

  let testTotal = 0;
  let prodTotal = 0;

  for (const [file, count] of sorted) {
    console.log(`  ${file}: ${count}`);
    if (test.includes(file)) {
      testTotal += count;
    } else {
      prodTotal += count;
    }
  }

  const total = candidates.length;
  console.log(`\nSummary:`);
  console.log(`  Test/fixture/snapshot files: ${testTotal} lines across ${test.length} files`);
  console.log(`  Production code files: ${prodTotal} lines across ${production.length} files`);
  console.log(`  Total: ${total} candidate lines across ${files.length} files`);
}
