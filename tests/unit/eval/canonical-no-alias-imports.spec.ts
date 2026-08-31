import fs from "fs";
import path from "path";

const FORBIDDEN_ALIAS_PATTERNS = [
  "tokensCompatible",
  "EQUIVALENCE_GROUPS",
  "PARENT_TO_CHILDREN",
];

function listCanonicalSourceFiles(): string[] {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const canonicalDir = path.join(repoRoot, "tests", "eval", "canonical");
  return fs
    .readdirSync(canonicalDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => path.join(canonicalDir, name));
}

describe("canonical module has no legacy alias tables", () => {
  it("does not reference tokensCompatible, EQUIVALENCE_GROUPS, or PARENT_TO_CHILDREN", () => {
    const offenders: Array<{ file: string; pattern: string }> = [];
    for (const filePath of listCanonicalSourceFiles()) {
      const text = fs.readFileSync(filePath, "utf8");
      for (const pattern of FORBIDDEN_ALIAS_PATTERNS) {
        if (text.includes(pattern)) {
          offenders.push({ file: path.basename(filePath), pattern });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
