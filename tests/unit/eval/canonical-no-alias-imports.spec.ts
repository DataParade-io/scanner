import fs from "fs";
import path from "path";

const FORBIDDEN_ALIAS_PATTERNS = [
  "tokensCompatible",
  "EQUIVALENCE_GROUPS",
  "PARENT_TO_CHILDREN",
];

function listCanonicalSourceFiles(): string[] {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const canonicalDirs = [
    path.join(repoRoot, "src", "eval", "canonical"),
    path.join(repoRoot, "tests", "eval", "canonical"),
  ];
  const files: string[] = [];

  function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
  }

  for (const dir of canonicalDirs) {
    walk(dir);
  }
  return files;
}

describe("canonical module has no legacy alias tables", () => {
  it("does not reference tokensCompatible, EQUIVALENCE_GROUPS, or PARENT_TO_CHILDREN", () => {
    const offenders: Array<{ file: string; pattern: string }> = [];
    for (const filePath of listCanonicalSourceFiles()) {
      const text = fs.readFileSync(filePath, "utf8");
      for (const pattern of FORBIDDEN_ALIAS_PATTERNS) {
        if (text.includes(pattern)) {
          offenders.push({ file: path.relative(path.resolve(__dirname, "..", "..", ".."), filePath), pattern });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
