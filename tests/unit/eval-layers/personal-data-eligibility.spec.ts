import fs from "fs";
import os from "os";
import path from "path";

import { collectPersonalDataFindings } from "../../../src/eval-layers/collect-personal-data-findings";
import { eligibleProcessedPaths } from "../../eval/eligibility/ledger-access";
import { createLayerLedger } from "../../eval/eligibility/types";
import { layerOutcome } from "../../../src/ingest/eligibility";

describe("eval-layers personal-data eligibility", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-pd-elig-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("marks yaml with PII as layer-processed for mentions but not components profile", async () => {
    fs.writeFileSync(
      path.join(tempDir, "application.yml"),
      "username: billing_app\n",
    );

    const mentions = await collectPersonalDataFindings(tempDir, "mentions");
    const mentionsLedger = createLayerLedger("mentions", mentions.layerOutcomes);
    expect(eligibleProcessedPaths(mentionsLedger)).toContain("application.yml");

    const componentsLedger = createLayerLedger("components", [
      layerOutcome("application.yml", "unsupported_file_type_or_language"),
    ]);
    expect(eligibleProcessedPaths(componentsLedger)).toEqual([]);
  });

  it("produces identical per-layer ledgers regardless of call order", async () => {
    fs.writeFileSync(path.join(tempDir, "a.yml"), "username: one\n");
    fs.writeFileSync(path.join(tempDir, "b.yml"), "password: two\n");

    const rawFirst = await collectPersonalDataFindings(tempDir, "raw-hits");
    const itemsSecond = await collectPersonalDataFindings(tempDir, "data-items");

    const mentionsOnly = await collectPersonalDataFindings(tempDir, "mentions");
    const rawOnly = await collectPersonalDataFindings(tempDir, "raw-hits");

    expect(rawFirst.layerOutcomes).toEqual(rawOnly.layerOutcomes);
    expect(eligibleProcessedPaths(createLayerLedger("raw-hits", rawFirst.layerOutcomes))).toEqual(
      eligibleProcessedPaths(createLayerLedger("raw-hits", rawOnly.layerOutcomes)),
    );
    expect(itemsSecond.layerOutcomes.length).toBeGreaterThan(0);
    expect(mentionsOnly.layerOutcomes).toEqual(
      (await collectPersonalDataFindings(tempDir, "mentions")).layerOutcomes,
    );
  });
});
