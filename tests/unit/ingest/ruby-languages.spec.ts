import fs from "fs/promises";
import os from "os";
import path from "path";

import { ingestFileSystem } from "../../../src/ingest/file-system";

describe("ingest/file-system - Ruby language mapping", () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "dp-ingest-ruby-"));

    const files: Record<string, string> = {
      "app.rb": 'require "sinatra"',
      "lib/tasks/billing.rake": "task :ping do; end",
      "notes.md": "# notes",
      "app/views/users/show.html.erb": "<%= @user.name %>",
    };

    for (const [name, content] of Object.entries(files)) {
      const abs = path.join(root, name);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf8");
    }

    for (const dir of ["tmp", "log", "storage", "vendor/bundle"]) {
      await fs.mkdir(path.join(root, dir), { recursive: true });
      await fs.writeFile(
        path.join(root, dir, "noise.rb"),
        'puts "noise"',
        "utf8",
      );
    }
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("maps .rb and .rake to ruby", async () => {
    const files = await ingestFileSystem(root);
    const byName = new Map(files.map((file) => [file.name, file.language]));

    expect(byName.get("app.rb")).toBe("ruby");
    expect(byName.get("billing.rake")).toBe("ruby");
    expect(byName.has("notes.md")).toBe(false);
    expect(byName.has("show.html.erb")).toBe(false);
  });

  it("excludes Rails tmp/log/storage and vendor by default", async () => {
    const files = await ingestFileSystem(root);
    const names = files.map((file) => file.name);

    expect(names).not.toContain("noise.rb");
  });
});
