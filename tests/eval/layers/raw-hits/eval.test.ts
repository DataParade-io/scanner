import { rawHitEvalCases } from "./cases";
import { scanFixtureRawHits } from "./adapter";
import { scoreEvalCases } from "../../score";

describe("eval/layers/raw-hits", () => {
  const fixtures = [...new Set(rawHitEvalCases.map((caseRecord) => caseRecord.fixture))];

  it("meets raw pattern hit layer ground-truth expectations", async () => {
    const scanResults = await Promise.all(fixtures.map(scanFixtureRawHits));
    const report = scoreEvalCases(rawHitEvalCases, scanResults);

    const failingPositives = report.caseResults.filter((result) => {
      const caseRecord = rawHitEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        !result.unread &&
        !result.matched
      );
    });
    expect(failingPositives).toEqual([]);

    const failingLabelPositives = report.caseResults.filter((result) => {
      const caseRecord = rawHitEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        result.matched &&
        !result.labelsCorrect
      );
    });
    expect(failingLabelPositives).toEqual([]);

    const failingNegatives = report.caseResults.filter((result) => {
      const caseRecord = rawHitEvalCases.find((entry) => entry.id === result.caseId)!;
      return caseRecord.expected.status === "negative" && !result.unread && !result.negativeClean;
    });
    expect(failingNegatives).toEqual([]);

    expect(report.scores.unreadCount).toBe(0);
    expect(report.scores.recall).toBe(1);
    expect(report.scores.negativeCasePassRate).toBe(1);
    expect(report.scores.precision).toBeNull();
  });
});
