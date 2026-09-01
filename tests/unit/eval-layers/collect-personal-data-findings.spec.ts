import fs from "fs";
import os from "os";
import path from "path";

import {
  buildPersonalDataFindingsPayload,
  buildPersonalDataInventory,
  collectPersonalDataFindings,
  projectPersonalDataFindings,
} from "../../../src/eval-layers/collect-personal-data-findings";

describe("eval-layers/personal-data inventory", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-eval-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("projects raw-hits and mentions with one evidence location per hit", async () => {
    fs.writeFileSync(
      path.join(tempDir, "application.yml"),
      ["spring:", "  datasource:", "    username: billing_app"].join("\n"),
    );

    const inventory = await buildPersonalDataInventory(tempDir);
    const rawHits = projectPersonalDataFindings(inventory, "raw-hits");
    const mentions = projectPersonalDataFindings(inventory, "mentions");

    expect(rawHits).toEqual([
      expect.objectContaining({
        subjectKey: "raw_hit:username",
        labels: ["username"],
        evidenceLocations: [
          {
            filePath: "application.yml",
            startLine: 3,
            endLine: 3,
          },
        ],
      }),
    ]);
    expect(mentions).toEqual([
      expect.objectContaining({
        subjectKey: "mention:username",
        labels: ["username"],
        evidenceLocations: [
          {
            filePath: "application.yml",
            startLine: 3,
            endLine: 3,
          },
        ],
      }),
    ]);
  });

  it("rolls duplicate rule hits into one data_item with all evidence locations", async () => {
    fs.writeFileSync(path.join(tempDir, "a.yml"), "username: app\n");
    fs.writeFileSync(path.join(tempDir, "b.yml"), "username: backup\n");

    const inventory = await buildPersonalDataInventory(tempDir);
    const findings = projectPersonalDataFindings(inventory, "data-items");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      subjectKey: "data_item:username",
      labels: ["username"],
      evidenceLocations: [
        { filePath: "a.yml", startLine: 1, endLine: 1 },
        { filePath: "b.yml", startLine: 1, endLine: 1 },
      ],
    });
  });

  it("builds per-layer payloads from one inventory without re-ingesting", async () => {
    fs.writeFileSync(path.join(tempDir, "a.yml"), "username: app\n");

    const inventory = await buildPersonalDataInventory(tempDir);
    const rawPayload = buildPersonalDataFindingsPayload(inventory, "raw-hits");
    const itemsPayload = buildPersonalDataFindingsPayload(inventory, "data-items");

    expect(rawPayload.filesScanned).toEqual(itemsPayload.filesScanned);
    expect(rawPayload.findings[0]?.subjectKey).toBe("raw_hit:username");
    expect(itemsPayload.findings[0]?.subjectKey).toBe("data_item:username");
  });
});

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
        evidenceLocations: [
          {
            filePath: "application.yml",
            startLine: 3,
            endLine: 3,
          },
        ],
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
});
