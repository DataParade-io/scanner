import path from "path";

import { scanRepoByManifestLayers } from "../../benchmark/scan-repo";
import { loadAnnotations, loadLayerScopes } from "../../benchmark/manifest";
import { annotationsToEvalCases } from "../../benchmark/to-eval-cases";
import { scoreEvalCases } from "../../eval/score";
import type { FixtureScanResult } from "../../eval/types";

const FIXTURES_ROOT = path.join(__dirname, "../../fixtures");
const BENCHMARK_REPOS = path.join(__dirname, "../../benchmark/repos");

describe("benchmark/scanRepoByManifestLayers data-actions", () => {
  it("emits asserted data-actions findings and ledger when layer is requested alone", async () => {
    const fixtureRoot = path.join(FIXTURES_ROOT, "data-actions-basic");
    const result = await scanRepoByManifestLayers("data-actions-basic", fixtureRoot, [
      "data_actions",
    ]);

    const dataActionFindings = result.findings.filter(
      (finding) => finding.layer === "data-actions",
    );
    expect(dataActionFindings.length).toBeGreaterThan(0);
    expect(result.findings.every((finding) => finding.layer === "data-actions")).toBe(true);
    expect(result.eligibilityLedgers?.["data-actions"]).toBeDefined();
    expect(result.eligibilityLedgers?.components).toBeUndefined();

    for (const finding of dataActionFindings) {
      expect(finding.labels).toHaveLength(1);
      expect(finding.labels[0]).toBeTruthy();
    }
    expect(
      dataActionFindings.some((finding) => finding.sourceFilePaths.length > 0),
    ).toBe(true);
  });

  it("converts corpus data_actions gold to EvalCases and scores via scoreEvalCases", () => {
    const repoDir = path.join(BENCHMARK_REPOS, "easy-school");
    const layerScopes = loadLayerScopes(repoDir);
    const annotations = loadAnnotations(repoDir, "data_actions");
    const evalCases = annotationsToEvalCases(annotations, "easy-school", {
      layerScopes,
      reviewStates: ["accepted"],
    });

    expect(evalCases.length).toBeGreaterThan(0);
    expect(evalCases.every((entry) => entry.layer === "data-actions")).toBe(true);
    expect(evalCases.every((entry) => (entry.exhaustiveScopeFiles?.length ?? 0) > 0)).toBe(
      true,
    );

    const emptyScan: FixtureScanResult = {
      fixture: "easy-school",
      findings: [],
      scannedFiles: [],
    };
    const report = scoreEvalCases(evalCases, [emptyScan]);
    expect(report.scores.denominators.evaluablePositives).toBe(evalCases.length);
    expect(report.caseResults).toHaveLength(evalCases.length);
  });
});
