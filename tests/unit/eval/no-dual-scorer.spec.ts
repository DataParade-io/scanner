import fs from "fs";
import path from "path";

const repoRoot = path.resolve(__dirname, "..", "..", "..");

const FORBIDDEN_PUBLIC_EXPORTS = [
  "loadLegacyGoldRecord",
  "buildScannerFinding",
  "nextSyntheticId",
  "evaluateCanonical",
  "EQUIVALENCE_GROUPS",
];

function listTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  function walk(current: string): void {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        files.push(fullPath);
      }
    }
  }
  walk(dir);
  return files;
}

describe("no dual scorer", () => {
  it("does not keep tests/eval/identity.ts", () => {
    expect(fs.existsSync(path.join(repoRoot, "tests/eval/identity.ts"))).toBe(false);
  });

  it("defines assignOneToOne and evaluateLayerBucket only under src/eval", () => {
    const assignOneToOneFiles: string[] = [];
    const evaluateLayerBucketFiles: string[] = [];

    for (const root of ["src", "tests"]) {
      const absRoot = path.join(repoRoot, root);
      for (const filePath of listTypeScriptFiles(absRoot)) {
        const text = fs.readFileSync(filePath, "utf8");
        if (/\bexport function assignOneToOne\b/.test(text)) {
          assignOneToOneFiles.push(path.relative(repoRoot, filePath));
        }
        if (/\bexport function evaluateLayerBucket\b/.test(text)) {
          evaluateLayerBucketFiles.push(path.relative(repoRoot, filePath));
        }
      }
    }

    expect(assignOneToOneFiles).toEqual(["src/eval/canonical/assignment.ts"]);
    expect(evaluateLayerBucketFiles).toEqual(["src/eval/evaluate.ts"]);
  });

  it("keeps forbidden symbols out of the published eval index", () => {
    const indexSource = fs.readFileSync(
      path.join(repoRoot, "src/eval/index.ts"),
      "utf8",
    );
    for (const symbol of FORBIDDEN_PUBLIC_EXPORTS) {
      expect(indexSource).not.toContain(symbol);
    }
  });

  it("does not re-export the eval scorer subpath from the root scanner index", () => {
    const rootIndex = fs.readFileSync(path.join(repoRoot, "src/index.ts"), "utf8");
    expect(rootIndex).not.toMatch(/from\s+["']\.\/eval/);
    expect(rootIndex).not.toContain("evaluateLayerBucket");
  });
});
