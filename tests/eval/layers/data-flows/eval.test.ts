import { dataFlowEvalCases } from "./cases";
import { scanFixtureDataFlows } from "./adapter";
import { scoreEvalCases } from "../../score";

describe("eval/layers/data-flows", () => {
  const fixtures = [...new Set(dataFlowEvalCases.map((caseRecord) => caseRecord.fixture))];

  it("meets data-flow layer ground-truth expectations", async () => {
    const scanResults = await Promise.all(fixtures.map(scanFixtureDataFlows));
    const report = scoreEvalCases(dataFlowEvalCases, scanResults);

    const failingNegatives = report.caseResults.filter((result) => {
      const caseRecord = dataFlowEvalCases.find((entry) => entry.id === result.caseId)!;
      return caseRecord.expected.status === "negative" && !result.unread && !result.negativeClean;
    });
    expect(failingNegatives).toEqual([]);

    expect(report.scores.unreadCount).toBe(0);
    expect(report.scores.denominators.evaluablePositives).toBe(0);
    expect(report.scores.recall).toBeNull();
    expect(report.scores.negativeCasePassRate).toBe(1);

    const documentedGapMisses = report.caseResults.filter(
      (result) => result.documentedGap && !result.matched,
    );
    expect(documentedGapMisses.length).toBeGreaterThan(0);

    expect(report.scores.precision).toBe(0);
    expect(report.scores.denominators.exhaustiveScopedFindings).toBeGreaterThan(0);
  });
});
