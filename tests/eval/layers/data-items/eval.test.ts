import { dataItemEvalCases } from "./cases";
import { scanFixtureDataItems } from "./adapter";
import { scoreEvalCases } from "../../score";

describe("eval/layers/data-items", () => {
  const fixtures = [...new Set(dataItemEvalCases.map((caseRecord) => caseRecord.fixture))];

  it("meets data-item layer ground-truth expectations", async () => {
    const scanResults = await Promise.all(fixtures.map(scanFixtureDataItems));
    const report = scoreEvalCases(dataItemEvalCases, scanResults);

    const failingPositives = report.caseResults.filter((result) => {
      const caseRecord = dataItemEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        !result.unread &&
        !result.matched
      );
    });
    expect(failingPositives).toEqual([]);

    const failingLabelPositives = report.caseResults.filter((result) => {
      const caseRecord = dataItemEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        result.matched &&
        !result.labelsCorrect
      );
    });
    expect(failingLabelPositives).toEqual([]);

    const failingNegatives = report.caseResults.filter((result) => {
      const caseRecord = dataItemEvalCases.find((entry) => entry.id === result.caseId)!;
      return caseRecord.expected.status === "negative" && !result.unread && !result.negativeClean;
    });
    expect(failingNegatives).toEqual([]);

    expect(report.scores.unreadCount).toBe(0);
    expect(report.scores.recall).toBe(1);
    expect(report.scores.negativeCasePassRate).toBe(1);
    expect(report.scores.precision).toBeNull();
  });
});
