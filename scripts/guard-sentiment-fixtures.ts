import fs from "fs";
import path from "path";

export interface GuardViolation {
  file: string;
  reason: string;
}

export interface GuardResult {
  checked: number;
  violations: GuardViolation[];
}

const MAX_FILE_BYTES = 1024 * 1024; // 1 MB — synthetic fixtures are small
const MAX_LINES = 5000;
const MAX_LINE_BYTES = 100 * 1024;

/**
 * Guard against real transcripts being committed under
 * tests/fixtures/sentiment/: fixtures must stay synthetic and hand-authored.
 * Real session dumps are large, long, and line-heavy; these heuristics catch
 * them without pinning the fixture format.
 */
export function guardSentimentFixtures(fixtureRoot: string): GuardResult {
  const violations: GuardViolation[] = [];
  let checked = 0;
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (entry.name === "README.md" || entry.name === ".gitkeep") continue;
      checked += 1;
      const stats = fs.statSync(full);
      if (stats.size > MAX_FILE_BYTES) {
        violations.push({ file: full, reason: `file is ${stats.size} bytes (limit ${MAX_FILE_BYTES}) — looks like a real dump` });
        continue;
      }
      if (/\.(log|sqlite|db|vscdb)$/i.test(entry.name)) {
        violations.push({ file: full, reason: "binary/log fixtures are generated at test time, never committed" });
        continue;
      }
      const content = fs.readFileSync(full, "utf8");
      const lines = content.split("\n");
      if (lines.length > MAX_LINES) {
        violations.push({ file: full, reason: `${lines.length} lines (limit ${MAX_LINES}) — looks like a real dump` });
        continue;
      }
      const longLine = lines.find((l) => l.length > MAX_LINE_BYTES);
      if (longLine !== undefined) {
        violations.push({ file: full, reason: "contains a line over 100 KB — looks like a real dump" });
      }
    }
  };
  visit(fixtureRoot);
  return { checked, violations };
}
