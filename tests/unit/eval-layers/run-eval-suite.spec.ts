import {
  formatEvalSuiteReport,
  runEvalSuite,
  type EvalSuiteResult,
} from "../../../scripts/run-eval-suite";

const EXPECTED_LAYERS = [
  "components",
  "data-flows",
  "raw-hits",
  "mentions",
  "data-items",
] as const;

describe("run-eval-suite", () => {
  let result: EvalSuiteResult;

  beforeAll(async () => {
    result = await runEvalSuite();
  }, 120_000);

  it("returns structured results for all five eval layers", () => {
    expect(result.layers).toHaveLength(5);
    expect(result.layers.map((layerSummary) => layerSummary.layer)).toEqual([
      ...EXPECTED_LAYERS,
    ]);

    for (const layerSummary of result.layers) {
      expect(layerSummary.fixtureCount).toBeGreaterThan(0);
      expect(layerSummary.cases.length).toBeGreaterThan(0);
      expect(layerSummary.report.caseResults).toHaveLength(layerSummary.cases.length);
      const { scores } = layerSummary.report;
      expect(scores.recall === null || typeof scores.recall === "number").toBe(true);
      expect(scores.labelAccuracy === null || typeof scores.labelAccuracy === "number").toBe(
        true,
      );
      expect(
        scores.correctLabelRecall === null || typeof scores.correctLabelRecall === "number",
      ).toBe(true);
      expect(scores.precision === null || typeof scores.precision === "number").toBe(true);
      expect(
        scores.negativeCasePassRate === null || typeof scores.negativeCasePassRate === "number",
      ).toBe(true);
      expect(typeof scores.unreadCount).toBe("number");
      expect(scores.denominators).toEqual(
        expect.objectContaining({
          evaluablePositives: expect.any(Number),
          matchedPositives: expect.any(Number),
          matchedWithCorrectLabels: expect.any(Number),
          negativeCases: expect.any(Number),
          negativeCasesPassed: expect.any(Number),
        }),
      );
    }

    expect(result.totalUniqueFixtures).toBeGreaterThan(0);
    expect(result.totalAssertions).toBe(
      result.layers.reduce((sum, layerSummary) => sum + layerSummary.cases.length, 0),
    );
    expect(typeof result.passed).toBe("boolean");
  });

  it("formats a human-readable report", () => {
    const report = formatEvalSuiteReport(result);
    expect(report).toContain("Fixture evaluation suite");
    expect(report).toContain("Repositories (unique fixtures):");
    expect(report).toContain("Assertions (all layers):");
    for (const layer of EXPECTED_LAYERS) {
      expect(report).toContain(layer);
      expect(report).toContain(`=== ${layer} ===`);
    }
  });
});
