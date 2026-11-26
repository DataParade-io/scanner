import fs from "fs";
import os from "os";
import path from "path";

import { ingestFileSystem } from "../../../src/ingest/file-system";
import {
  gitignoreLineToRegex,
  gitignoreRulesForDir,
  isPathIgnored,
  readGitignore,
} from "../../../src/ingest/gitignore";

function write(root: string, rel: string, content = "export const x = 1;\n"): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}

describe("ingest/gitignore", () => {
  it("skips paths matched by test-project-scan/* at any depth", async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "dp-cli-gitignore-scan-"),
    );

    try {
      fs.writeFileSync(
        path.join(tempRoot, ".gitignore"),
        "test-project-scan/*\n",
        "utf8",
      );
      fs.mkdirSync(path.join(tempRoot, "test-project-scan", "app", "src"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(tempRoot, "test-project-scan", "app", "src", "index.ts"),
        "export const x = 1;\n",
        "utf8",
      );
      fs.mkdirSync(path.join(tempRoot, "included"), { recursive: true });
      fs.writeFileSync(
        path.join(tempRoot, "included", "index.ts"),
        "export const y = 2;\n",
        "utf8",
      );

      const files = await ingestFileSystem(tempRoot);
      const paths = files.map((f) => f.path);

      expect(paths).toContain("included/index.ts");
      expect(paths.some((p) => p.startsWith("test-project-scan/"))).toBe(false);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("follows git's anchoring rules", () => {
    const matches = (line: string, rel: string) => gitignoreLineToRegex(line).test(rel);
    // A leading slash anchors to the .gitignore's directory.
    expect(matches("/generated", "generated")).toBe(true);
    expect(matches("/generated", "lib/generated")).toBe(false);
    // No slash: a name at any depth.
    expect(matches("build", "packages/web/build")).toBe(true);
    expect(matches("*.log", "logs/app/debug.log")).toBe(true);
    // A slash in the middle anchors.
    expect(matches("src/gen", "src/gen")).toBe(true);
    expect(matches("src/gen", "lib/src/gen")).toBe(false);
    // `**` segments match zero or more directories.
    expect(matches("**/fixtures", "a/b/fixtures")).toBe(true);
    expect(matches("**/fixtures", "fixtures")).toBe(true);
    expect(matches("a/**/b", "a/b")).toBe(true);
    expect(matches("a/**/b", "a/x/y/b")).toBe(true);
    // A matched directory covers what is under it.
    expect(matches("/generated", "generated/prisma/index.js")).toBe(true);
    expect(matches("/generated", "generatedx")).toBe(false);
  });

  it("applies dir-only and negated rules", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-gitignore-rules-"));
    try {
      write(root, ".gitignore", "/.next/\nout/\n*.log\n!keep.log\n");
      const rules = await readGitignore(root);
      expect(isPathIgnored(path.join(root, ".next"), true, rules)).toBe(true);
      expect(isPathIgnored(path.join(root, "web", "out"), true, rules)).toBe(true);
      // `out/` only names directories.
      expect(isPathIgnored(path.join(root, "web", "out"), false, rules)).toBe(false);
      expect(isPathIgnored(path.join(root, "a", "debug.log"), false, rules)).toBe(true);
      expect(isPathIgnored(path.join(root, "a", "keep.log"), false, rules)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not copy the inherited rules for a directory without a .gitignore", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-gitignore-share-"));
    try {
      write(root, ".gitignore", "dist\n");
      write(root, "src/index.ts");
      const rootRules = await gitignoreRulesForDir(root, []);
      const srcRules = await gitignoreRulesForDir(path.join(root, "src"), rootRules);
      expect(srcRules).toBe(rootRules);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips anchored and nested ignored directories during ingest", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-gitignore-ingest-"));
    try {
      // The ignore list `create-next-app` and Prisma's generator output produce.
      write(root, ".gitignore", "/node_modules\n/.next/\n/out/\n/build\n/generated/prisma\n*.tsbuildinfo\n");
      write(root, "app/api/users/route.ts");
      write(root, "generated/prisma/index.js", "module.exports = { email: 1 };\n");
      write(root, "generated/other/keep.ts");
      write(root, "packages/web/.gitignore", "cache\n");
      write(root, "packages/web/src/cache/data.json", "{}\n");
      write(root, "packages/web/src/page.ts");

      const paths = (await ingestFileSystem(root)).map((f) => f.path).sort();

      expect(paths).toEqual([
        "app/api/users/route.ts",
        "generated/other/keep.ts",
        "packages/web/src/page.ts",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
