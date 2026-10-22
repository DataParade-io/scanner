import { promises as fs } from "fs";
import * as path from "path";

export type IgnoreRule = {
  baseDir: string;
  pattern: string;
  negate: boolean;
  dirOnly: boolean;
  regex: RegExp;
};

export function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

function globToRegexBody(pattern: string): string {
  let escaped = pattern.replace(/[-\\^$+?.()|[\]{}*?]/g, "\\$&");

  // Restore globs
  escaped = escaped.replace(/\\\*\\\*/g, ".*"); // **
  escaped = escaped.replace(/\\\*/g, "[^/]*"); // *
  escaped = escaped.replace(/\\\?/g, "[^/]"); // ?
  return escaped;
}

/**
 * Glob to regex for user exclude patterns, matched against the path relative to the
 * scan root:
 * - * matches any chars except path separator
 * - ** matches across directories
 * - ? matches a single non-separator
 */
export function gitignorePatternToRegex(
  pattern: string,
  dirOnly: boolean,
): RegExp {
  const suffix = dirOnly ? "(?:/.*)?$" : "$";
  // Match from start of the relative path
  return new RegExp(`^${globToRegexBody(pattern)}${suffix}`);
}

/**
 * Regex for one `.gitignore` line, matched against the path relative to the
 * `.gitignore`'s directory, following git's rules:
 * - a leading `/` anchors the pattern to that directory;
 * - a pattern with no other `/` matches a name at any depth (`build`, `*.log`);
 * - a pattern with a `/` in the middle is anchored (`src/gen`);
 * - a leading or inner `**` segment matches zero or more directories.
 * A match on a directory also ignores everything under it.
 */
export function gitignoreLineToRegex(line: string): RegExp {
  let pattern = toPosixPath(line);
  let anchored = false;
  if (pattern.startsWith("/")) {
    anchored = true;
    pattern = pattern.replace(/^\/+/, "");
  } else if (pattern.startsWith("**/")) {
    pattern = pattern.slice(3);
  } else if (pattern.includes("/")) {
    anchored = true;
  }
  let body = globToRegexBody(pattern);
  // `a/**/b` also matches `a/b`.
  body = body.replace(/\/\.\*\//g, "/(?:.*/)?");
  const prefix = anchored ? "" : "(?:.*/)?";
  // `dirOnly` rules are only applied to directories (see isPathIgnored); either kind
  // also covers what lies under the matched path.
  return new RegExp(`^${prefix}${body}(?:/.*)?$`);
}

export async function readGitignore(dir: string): Promise<IgnoreRule[]> {
  const gitignorePath = path.join(dir, ".gitignore");
  try {
    const content = await fs.readFile(gitignorePath, "utf8");
    const lines = content.split(/\r?\n/);
    const rules: IgnoreRule[] = [];

    for (const rawLine of lines) {
      let line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      let negate = false;
      if (line.startsWith("!")) {
        negate = true;
        line = line.slice(1).trim();
        if (!line) continue;
      }

      let dirOnly = false;
      if (line.endsWith("/")) {
        dirOnly = true;
        line = line.slice(0, -1);
        if (!line) continue;
      }

      const regex = gitignoreLineToRegex(line);
      rules.push({
        baseDir: dir,
        pattern: line,
        negate,
        dirOnly,
        regex,
      });
    }

    return rules;
  } catch (error: unknown) {
    // If .gitignore does not exist, ignore silently
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function gitignoreRulesForDir(
  currentDir: string,
  accumulatedRules: IgnoreRule[],
): Promise<IgnoreRule[]> {
  const localRules = await readGitignore(currentDir);
  // Most directories have no .gitignore: share the parent's array instead of copying it
  // once per directory.
  return localRules.length === 0 ? accumulatedRules : accumulatedRules.concat(localRules);
}

export function isPathIgnored(
  absolutePath: string,
  isDirectory: boolean,
  rules: IgnoreRule[],
): boolean {
  const normalizedPath = toPosixPath(absolutePath);
  let ignored = false;

  for (const rule of rules) {
    const base = toPosixPath(rule.baseDir);
    if (!normalizedPath.startsWith(base.endsWith("/") ? base : `${base}/`)) {
      continue;
    }

    const rel = normalizedPath.slice(base.length + (base.endsWith("/") ? 0 : 1));
    if (!rel) continue;

    if (rule.dirOnly && !isDirectory) {
      continue;
    }

    if (rule.regex.test(rel)) {
      ignored = !rule.negate;
    }
  }

  return ignored;
}
