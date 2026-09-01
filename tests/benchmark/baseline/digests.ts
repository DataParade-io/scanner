import crypto from "crypto";
import fs from "fs";
import path from "path";

/** Stable sha256 digest prefixed for interchange. */
export function sha256Digest(content: string | Buffer): string {
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return `sha256:${hash}`;
}

/** Canonical JSON with sorted object keys at every level. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function digestStableJson(value: unknown): string {
  return sha256Digest(stableStringify(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortKeysDeep(record[key]);
  }
  return sorted;
}

export function digestFile(filePath: string): string {
  return sha256Digest(fs.readFileSync(filePath));
}

export function digestSortedFiles(filePaths: string[]): string {
  const parts: string[] = [];
  for (const filePath of [...filePaths].sort()) {
    parts.push(filePath);
    parts.push(fs.readFileSync(filePath, "utf8"));
  }
  return sha256Digest(parts.join("\0"));
}

/** Digest file contents keyed by stable relative paths (POSIX separators). */
export function digestSortedFilesWithKeys(
  entries: Array<{ key: string; filePath: string }>,
): string {
  const parts: string[] = [];
  for (const entry of [...entries].sort((left, right) => left.key.localeCompare(right.key))) {
    parts.push(entry.key);
    parts.push(fs.readFileSync(entry.filePath, "utf8"));
  }
  return sha256Digest(parts.join("\0"));
}

function corpusGoldRelativeKey(benchmarkRoot: string, filePath: string): string {
  return path
    .relative(path.resolve(benchmarkRoot), path.resolve(filePath))
    .split(path.sep)
    .join("/");
}

export function walkCorpusGoldFiles(benchmarkRoot: string): string[] {
  const reposRoot = path.join(benchmarkRoot, "repos");
  if (!fs.existsSync(reposRoot)) {
    return [];
  }

  const files: string[] = [];
  const repoKeys = fs
    .readdirSync(reposRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const repoKey of repoKeys) {
    const repoDir = path.join(reposRoot, repoKey);
    const manifestPath = path.join(repoDir, "manifest.yaml");
    if (fs.existsSync(manifestPath)) {
      files.push(manifestPath);
    }
    const scopesPath = path.join(repoDir, "layer-scopes.yaml");
    if (fs.existsSync(scopesPath)) {
      files.push(scopesPath);
    }
    const annotationsDir = path.join(repoDir, "annotations");
    if (fs.existsSync(annotationsDir)) {
      for (const fileName of fs.readdirSync(annotationsDir).sort()) {
        if (fileName.endsWith(".yaml") || fileName.endsWith(".yml")) {
          files.push(path.join(annotationsDir, fileName));
        }
      }
    }
  }

  return files;
}

export function digestCorpusGold(benchmarkRoot: string): string {
  const files = walkCorpusGoldFiles(benchmarkRoot);
  if (files.length === 0) {
    return sha256Digest("");
  }
  return digestSortedFilesWithKeys(
    files.map((filePath) => ({
      key: corpusGoldRelativeKey(benchmarkRoot, filePath),
      filePath,
    })),
  );
}
