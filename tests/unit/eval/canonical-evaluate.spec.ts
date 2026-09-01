import { evaluateCanonical } from "../../eval/canonical/evaluate-fixture";
import {
  assignOneToOne,
  buildAcceptedGoldExpectation,
  buildScannerFinding,
  sampleEvidence,
  withId,
} from "../../eval/canonical";
import type { EvalCase, FixtureScanResult, LayerFinding } from "../../eval/types";
import { layerOutcome } from "../../../src/ingest/eligibility";
import { createLayerLedger } from "../../eval/eligibility/types";

const FIXTURE = "assignment-fixture";

function scanResult(
  findings: LayerFinding[],
  layer: EvalCase["layer"],
  processedPaths: string[] = ["src/app.yml"],
): FixtureScanResult {
  const ledger = createLayerLedger(
    layer,
    processedPaths.map((filePath) => layerOutcome(filePath, "successfully_processed")),
  );
  return {
    fixture: FIXTURE,
    findings,
    scannedFiles: processedPaths,
    eligibilityLedgers: { [layer]: ledger },
  };
}

function dataItemCase(id: string, filePath: string, line: number): EvalCase {
  return {
    id,
    fixture: FIXTURE,
    layer: "data-items",
    subject: { key: "data_item:email", name: "data_item:email" },
    evidence: { file_path: filePath, start_line: line, end_line: line },
    expected: { status: "positive", labels: ["email"] },
    rationale: "synthetic data-item",
  };
}

describe("evaluateCanonical assignment", () => {
  it("does not let one finding credit multiple same-identity data-item rows in different files", () => {
    const cases = [
      dataItemCase("gold-a", "src/a.yml", 1),
      dataItemCase("gold-b", "src/b.yml", 2),
    ];
    const findings: LayerFinding[] = [
      {
        key: "data_item:email",
        labels: ["email"],
        sourceFilePaths: ["src/a.yml"],
        sourceLines: [{ file_path: "src/a.yml", start_line: 1, end_line: 1 }],
        layer: "data-items",
      },
    ];

    const report = evaluateCanonical(cases, [scanResult(findings, "data-items", ["src/a.yml", "src/b.yml"])]);

    expect(report.scores.denominators.evaluablePositives).toBe(2);
    expect(report.scores.denominators.matchedPositives).toBe(1);
    expect(report.scores.recall).toBe(0.5);
  });

  it("disambiguates shared component identity keys by evidence overlap", () => {
    const evidenceA = [sampleEvidence("src/one.rb", 3, 3)];
    const evidenceB = [sampleEvidence("src/two.rb", 3, 3)];
    const expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "components",
          identityKey: "asset:database",
          conceptLeaf: "database",
          componentType: "asset",
          componentSubtype: "database",
          evidenceLocations: evidenceA,
        }),
        "gold-a",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "components",
          identityKey: "asset:database",
          conceptLeaf: "database",
          componentType: "asset",
          componentSubtype: "database",
          evidenceLocations: evidenceB,
        }),
        "gold-b",
      ),
    ];
    const finding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "asset:admin_dashboard_data",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidenceA,
      }),
      "find-1",
    );

    const assignment = assignOneToOne(expectations, [finding]);
    expect(assignment.ambiguous).toBe(false);
    expect(assignment.pairs).toEqual([{ expectationId: "gold-a", findingId: "find-1" }]);
  });
});

function mentionCase(id: string, filePath: string, scope?: string[]): EvalCase {
  return {
    id,
    fixture: FIXTURE,
    layer: "mentions",
    subject: { key: "mention:email" },
    evidence: { file_path: filePath, start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["mention"] },
    rationale: "test",
    exhaustiveScopeFiles: scope,
  };
}

describe("evaluateCanonical metric computability", () => {
  it("keeps recall computable when precision has no reviewed scope", () => {
    const cases = [mentionCase("m1", "src/app.ts")];
    const findings: LayerFinding[] = [
      {
        key: "mention:email",
        labels: ["mention"],
        sourceFilePaths: ["src/app.ts"],
        sourceLines: [{ file_path: "src/app.ts", start_line: 1, end_line: 1 }],
        layer: "mentions",
      },
    ];

    const report = evaluateCanonical(cases, [scanResult(findings, "mentions", ["src/app.ts"])]);

    expect(report.scores.metricComputability.metrics.recall.state).toBe("computable");
    expect(report.scores.metricComputability.metrics.precision.state).toBe("no_reviewed_scope");
  });

  it("marks processed scope with zero predictions separately from missing scope", () => {
    const cases = [mentionCase("m1", "src/app.ts", ["src/scoped.ts"])];

    const report = evaluateCanonical(cases, [scanResult([], "mentions", ["src/scoped.ts"])]);

    expect(report.scores.metricComputability.metrics.precision.state).toBe(
      "processed_scope_zero_predictions",
    );
    expect(report.scores.metricComputability.scope.processedScopeFileCount).toBe(1);
    expect(report.scores.denominators.exhaustiveScopedFindings).toBe(0);
  });
});
