/**
 * Candidate line inventory extraction from source code.
 *
 * Matches tokens (e.g., email, sender, recipient) in various naming styles
 * and outputs deterministic YAML with candidate lines for labeling.
 */

import fs from "fs";
import path from "path";
import YAML from "yaml";

export interface CandidateRecord {
  file: string;
  line: number;
  text: string;
}

export interface CandidatesOutput {
  candidates: CandidateRecord[];
}

/**
 * Convert a token with separators (e.g., "from_address", "fromAddress")
 * to regex patterns that match case-insensitively across styles.
 *
 * Matches the token when:
 * 1. Surrounded by word boundaries (standalone word)
 * 2. In camelCase (Email in EmailValidator, sendEmail, emails)
 * 3. With separators (email_address, EMAIL-FROM, e-mail)
 *
 * Does NOT match partial words like "reemails" (email within a word).
 */
export function createTokenPatterns(token: string): RegExp[] {
  // Split token into parts: split on non-alphanumeric and handle camelCase
  const parts: string[] = [];
  let current = "";

  for (let i = 0; i < token.length; i++) {
    const char = token[i];
    const isUpper = /[A-Z]/.test(char);
    const isAlpha = /[a-zA-Z]/.test(char);
    const isDigit = /[0-9]/.test(char);

    if (!isAlpha && !isDigit) {
      // Separator character
      if (current) {
        parts.push(current.toLowerCase());
        current = "";
      }
    } else if (isUpper && current && /[a-z]/.test(current[current.length - 1])) {
      // CamelCase boundary: lowercase to uppercase
      parts.push(current.toLowerCase());
      current = char.toLowerCase();
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current.toLowerCase());
  }

  const patterns: RegExp[] = [];

  if (parts.length === 1) {
    const part = parts[0];
    // Single token case: match in multiple contexts

    // 1. Standalone word with word boundaries: \bemail\b
    patterns.push(new RegExp(`\\b${part}\\b`, "i"));

    // 2. Start of camelCase: \bemail[A-Z] (EmailValidator, emails)
    patterns.push(new RegExp(`\\b${part}[A-Z]`, "i"));

    // 3. End of camelCase: [a-z]email\b (sendEmail, userEmail)
    patterns.push(new RegExp(`[a-z]${part}\\b`, "i"));

    // 4. With separators: _email, email_, e-mail, EMAIL_ADDRESS
    patterns.push(new RegExp(`[_\\-]${part}\\b`, "i"));
    patterns.push(new RegExp(`\\b${part}[_\\-]`, "i"));
  } else {
    // Multiple parts case (e.g., "from_address")
    const separators = "[_\\-]?";
    const pattern = parts.join(separators);
    patterns.push(new RegExp(`\\b${pattern}\\b`, "i"));
    patterns.push(new RegExp(`\\b${pattern}[_\\-A-Z]`, "i"));
  }

  return patterns;
}

/**
 * Check if any token pattern matches the line.
 */
export function lineContainsToken(line: string, patterns: RegExp[][]): boolean {
  for (const patternSet of patterns) {
    for (const pattern of patternSet) {
      if (pattern.test(line)) {
        return true;
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
 * Extract candidate lines from files that match any token pattern.
 */
export function extractCandidates(
  tokens: string[],
  repoDir: string,
  files: string[],
): CandidateRecord[] {
  const candidates: CandidateRecord[] = [];
  const patterns = tokens.map((token) => createTokenPatterns(token));

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
        if (lineContainsToken(line, patterns)) {
          candidates.push({
            file,
            line: i + 1, // 1-based line numbers
            text: line.trim(),
          });
        }
      }
    } catch (error) {
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
