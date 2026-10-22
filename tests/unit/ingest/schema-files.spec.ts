import fs from "fs";
import os from "os";
import path from "path";

import { readSchemaFiles } from "../../../src/ingest/schema-files";

function write(root: string, rel: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}

describe("ingest/schema-files", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-schema-files-"));
    write(root, "prisma/schema.prisma", "model User {\n  email String\n}\n");
    write(root, "db/structure.sql", "CREATE TABLE users (email text);\n");
    write(root, "node_modules/pkg/schema.sql", "CREATE TABLE a (b text);\n");
    write(root, ".next/server/x.sql", "CREATE TABLE a (b text);\n");
    write(root, "generated/prisma/schema.prisma", "model Copy {\n  email String\n}\n");
    write(root, "legacy/dump.sql", "CREATE TABLE old (email text);\n");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("skips default excluded directories", async () => {
    const paths = (await readSchemaFiles(root)).map((file) => file.path).sort();
    expect(paths).toEqual([
      "db/structure.sql",
      "generated/prisma/schema.prisma",
      "legacy/dump.sql",
      "prisma/schema.prisma",
    ]);
  });

  it("applies .gitignore and the scan's exclude patterns", async () => {
    write(root, ".gitignore", "/generated\n");
    const paths = (await readSchemaFiles(root, { excludePaths: ["legacy/**"] }))
      .map((file) => file.path)
      .sort();
    expect(paths).toEqual(["db/structure.sql", "prisma/schema.prisma"]);
  });

  it("does not enter excluded directories", async () => {
    write(root, ".gitignore", "/generated\n");
    const readdir = jest.spyOn(fs.promises, "readdir");
    try {
      await readSchemaFiles(root, { excludePaths: ["legacy/**"] });
      const visited = readdir.mock.calls.map(([dir]) =>
        path.relative(root, String(dir)).split(path.sep).join("/"),
      );
      expect(visited).not.toContain("generated");
      expect(visited).not.toContain("legacy");
      expect(visited).not.toContain("node_modules");
      expect(visited).not.toContain(".next");
      expect(visited).toContain("prisma");
    } finally {
      readdir.mockRestore();
    }
  });
});
