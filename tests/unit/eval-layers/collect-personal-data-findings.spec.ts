import fs from "fs";
import os from "os";
import path from "path";

import { collectPersonalDataFindings } from "../../../src/eval-layers/collect-personal-data-findings";

describe("eval-layers/collectPersonalDataFindings", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-eval-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("emits raw_hit identities per line hit", async () => {
    fs.writeFileSync(
      path.join(tempDir, "application.yml"),
      ["spring:", "  datasource:", "    username: billing_app"].join("\n"),
    );

    const result = await collectPersonalDataFindings(tempDir, "raw-hits");

    expect(result.findings).toEqual([
      expect.objectContaining({
        subjectKey: "raw_hit:username",
        labels: ["username"],
        filePath: "application.yml",
        startLine: 3,
        endLine: 3,
      }),
    ]);
    expect(result.filesScanned).toEqual(["application.yml"]);
  });

  it("emits mention identities per line hit", async () => {
    fs.writeFileSync(
      path.join(tempDir, "application.yml"),
      ["spring:", "  datasource:", "    username: billing_app"].join("\n"),
    );

    const result = await collectPersonalDataFindings(tempDir, "mentions");

    expect(result.findings).toEqual([
      expect.objectContaining({
        subjectKey: "mention:username",
        labels: ["username"],
      }),
    ]);
  });

  it("rolls duplicate rule hits into one data_item identity", async () => {
    fs.writeFileSync(path.join(tempDir, "a.yml"), "username: app\n");
    fs.writeFileSync(path.join(tempDir, "b.yml"), "username: backup\n");

    const result = await collectPersonalDataFindings(tempDir, "data-items");

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual(
      expect.objectContaining({
        subjectKey: "data_item:username",
        labels: ["username"],
      }),
    );
  });
});
