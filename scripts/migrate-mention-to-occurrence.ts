#!/usr/bin/env node
/**
 * One-off codemod: rename "mention" to "occurrence" across the scanner (KDATAP-3f9029).
 *
 * An occurrence is one place where a data item appears in code, with its location and
 * role; the term follows Sourcegraph SCIP. Kept in the repo as the record of the
 * migration.
 *
 *   npx ts-node scripts/migrate-mention-to-occurrence.ts [--dry-run]
 *
 * - Code, tests, scripts, features and docs: every identifier or word form is renamed
 *   (ScanMention -> ScanOccurrence, mentionIds -> occurrenceIds, mention_attributes ->
 *   occurrence_attributes, "mentions" -> "occurrences"), except English verb forms
 *   ("mentioned", "mentioning") and "webmention".
 * - Gold YAML under tests/benchmark/repos: only structured fields change (layer names,
 *   subject keys, attribute blocks, scope and manifest keys). Rationales, quoted source
 *   and token names stay as written: they come from the scanned repositories.
 * - Paths containing "mention" are renamed with git mv.
 * - Not touched: generated reports (tests/benchmark/reports), materialized repos, and
 *   historical work logs (annotations/, findings/).
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = path.resolve(__dirname, "..");

const EXCLUDED_PREFIXES = [
  "tests/benchmark/reports/",
  "tests/benchmark/.cache/",
  "annotations/",
  "findings/",
  "project/",
  "node_modules/",
  "dist/",
  "scripts/migrate-mention-to-occurrence.ts",
];
/**
 * English prose that happens to contain the word, and files whose legacy readers name
 * the old terms on purpose (so a re-run never rewrites them).
 */
const EXCLUDED_FILES = new Set([
  "patterns/csharp.md",
  "tests/benchmark/baseline/collect-gold-stats.ts",
  "tests/benchmark/manifest.ts",
  "tests/benchmark/scan-repo.ts",
  "tests/benchmark/schema.ts",
  "tests/benchmark/to-eval-cases.ts",
  "tests/eval/canonical/gold/loader.ts",
  "tests/eval/ground-truth-schema.md",
  "tests/unit/benchmark/packet-validation.spec.ts",
]);
const TEXT_EXTENSIONS = new Set([".ts", ".js", ".json", ".md", ".yaml", ".yml", ".csv", ".feature", ".txt"]);

/** Case-preserving replacement of one matched word form. */
function swapCase(match: string, plural: boolean): string {
  const base = plural ? "occurrences" : "occurrence";
  if (match === match.toUpperCase()) return base.toUpperCase();
  if (match[0] === match[0].toUpperCase()) return base[0].toUpperCase() + base.slice(1);
  return base;
}

/**
 * Rename every mention/mentions word form, inside identifiers too, skipping English
 * verb forms and "webmention".
 */
export function renameAll(text: string): string {
  return text.replace(/(?<![Ww]eb)(mentions|mention)(?!ed|ing)/gi, (match: string) =>
    swapCase(match, match.toLowerCase() === "mentions"),
  );
}

/** Gold YAML: structured fields only. */
export function renameGold(text: string, file: string): string {
  let out = text
    .replace(/^(\s*-?\s*layer:\s*)mentions\s*$/gm, "$1occurrences")
    .replace(/^(\s*-?\s*key:\s*)mention:/gm, "$1occurrence:")
    .replace(/^(\s*)mention_attributes:/gm, "$1occurrence_attributes:")
    .replace(/^(\s*-\s*)mention:/gm, "$1occurrence:");
  const base = path.basename(file);
  if (base.endsWith("-grouping-input.yaml")) {
    out = out.replace(/^positive_mentions:/gm, "positive_occurrences:").replace(/^(\s+)mentions:$/gm, "$1occurrences:");
  }
  if (base === "layer-scopes.yaml" || base === "manifest.yaml") {
    out = out.replace(/^(\s*-?\s*)mentions(:?\s*)$/gm, "$1occurrences$2");
  }
  return out;
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter((file) => file.length > 0)
    .filter((file) => !EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix)))
    .filter((file) => !EXCLUDED_FILES.has(file));
}

function isGold(file: string): boolean {
  return file.startsWith("tests/benchmark/repos/") && /\.ya?ml$/.test(file);
}

function main(): void {
  let changedFiles = 0;
  for (const file of trackedFiles()) {
    if (!TEXT_EXTENSIONS.has(path.extname(file))) continue;
    const full = path.join(ROOT, file);
    const before = fs.readFileSync(full, "utf8");
    if (!/mention/i.test(before)) continue;
    const after = isGold(file) ? renameGold(before, file) : renameAll(before);
    if (after !== before) {
      changedFiles += 1;
      if (!DRY_RUN) fs.writeFileSync(full, after);
    }
  }

  const moves: Array<[string, string]> = [];
  for (const file of trackedFiles()) {
    if (!/mention/i.test(file)) continue;
    const target = file
      .split("/")
      .map((part) => renameAll(part))
      .join("/");
    if (target !== file) moves.push([file, target]);
  }
  for (const [from, to] of moves) {
    if (DRY_RUN) continue;
    fs.mkdirSync(path.join(ROOT, path.dirname(to)), { recursive: true });
    execFileSync("git", ["mv", from, to], { cwd: ROOT });
  }
  console.log(`${DRY_RUN ? "would change" : "changed"} ${changedFiles} files, ${moves.length} renames`);
  for (const [from, to] of moves) console.log(`  ${from} -> ${to}`);
}

if (require.main === module) main();
