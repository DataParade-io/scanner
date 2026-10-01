import fs from "fs";
import os from "os";
import path from "path";

import { scanRepoByManifestLayers } from "../../benchmark/scan-repo";
import { eligibleProcessedPaths } from "../../eval/eligibility/ledger-access";
import { scoreEvalCases } from "../../eval/score";
import type { EvalCase } from "../../eval/types";

describe("scanRepoByManifestLayers eligibility", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "scanner-scan-repo-elig-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not confer cross-layer eligibility", async () => {
    fs.writeFileSync(path.join(tempDir, "orch.ts"), "export const db = 'pg';\n");
    fs.writeFileSync(path.join(tempDir, "pii.yml"), "username: secret\n");

    const result = await scanRepoByManifestLayers("fixture", tempDir, [
      "components",
      "occurrences",
    ]);

    const componentsEligible = eligibleProcessedPaths(result.eligibilityLedgers?.components);
    const occurrencesEligible = eligibleProcessedPaths(result.eligibilityLedgers?.occurrences);

    expect(componentsEligible).toContain("orch.ts");
    expect(occurrencesEligible).toContain("pii.yml");
    expect(componentsEligible).not.toContain("pii.yml");

    const evalCase: EvalCase = {
      id: "occurrences-case",
      fixture: "fixture",
      layer: "occurrences",
      subject: { key: "occurrence:username" },
      evidence: { file_path: "pii.yml", start_line: 1, end_line: 1 },
      expected: { status: "positive", labels: ["username"] },
      rationale: "cross-layer isolation",
    };

    const report = scoreEvalCases([evalCase], [result]);
    expect(report.caseResults[0]?.unread).toBe(false);

    const componentsOnlyLedger = {
      ...result,
      eligibilityLedgers: { components: result.eligibilityLedgers?.components },
      scannedFiles: componentsEligible,
    };
    const unreadReport = scoreEvalCases([evalCase], [componentsOnlyLedger]);
    expect(unreadReport.caseResults[0]?.unread).toBe(true);
  });

  it("uses each personal-data layer ledger independently", async () => {
    fs.writeFileSync(path.join(tempDir, "signals.yml"), "email: a@b.com\n");

    const rawOnly = await scanRepoByManifestLayers("fixture", tempDir, ["raw_hits"]);
    const occurrencesOnly = await scanRepoByManifestLayers("fixture", tempDir, ["occurrences"]);

    expect(eligibleProcessedPaths(rawOnly.eligibilityLedgers?.["raw-hits"])).toEqual(
      eligibleProcessedPaths(occurrencesOnly.eligibilityLedgers?.occurrences),
    );
    expect(rawOnly.eligibilityLedgers?.occurrences).toBeUndefined();
    expect(occurrencesOnly.eligibilityLedgers?.["raw-hits"]).toBeUndefined();
  });
});
