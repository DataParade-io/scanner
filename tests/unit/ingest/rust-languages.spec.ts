import fs from "fs/promises";
import os from "os";
import path from "path";

import { ingestFileSystem } from "../../../src/ingest/file-system";

describe("ingest/file-system - Rust language mapping", () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "dp-ingest-rust-"));

    const files: Record<string, string> = {
      "main.rs": "fn main() {}",
      "lib.rs": "pub mod routes;",
      "notes.md": "# notes",
    };

    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(root, name), content, "utf8");
    }

    await fs.mkdir(path.join(root, "target", "debug"), { recursive: true });
    await fs.writeFile(
      path.join(root, "target", "debug", "generated.rs"),
      "fn generated() {}",
      "utf8",
    );
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("maps .rs to rust", async () => {
    const files = await ingestFileSystem(root);
    const byName = new Map(files.map((file) => [file.name, file.language]));

    expect(byName.get("main.rs")).toBe("rust");
    expect(byName.get("lib.rs")).toBe("rust");
    expect(byName.has("notes.md")).toBe(false);
  });

  it("excludes Cargo target/ by default", async () => {
    const files = await ingestFileSystem(root);
    const names = files.map((file) => file.name);

    expect(names).not.toContain("generated.rs");
  });
});
