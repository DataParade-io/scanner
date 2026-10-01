import { occurrenceEvalCases } from "./cases";
import { scanFixtureOccurrences } from "./adapter";
import { scoreEvalCases } from "../../score";

describe("eval/layers/occurrences", () => {
  const fixtures = [...new Set(occurrenceEvalCases.map((caseRecord) => caseRecord.fixture))];

  it("meets occurrence layer ground-truth expectations", async () => {
    const scanResults = await Promise.all(fixtures.map(scanFixtureOccurrences));
    const report = scoreEvalCases(occurrenceEvalCases, scanResults);

    const failingPositives = report.caseResults.filter((result) => {
      const caseRecord = occurrenceEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        !result.unread &&
        !result.matched
      );
    });
    expect(failingPositives).toEqual([]);

    const failingLabelPositives = report.caseResults.filter((result) => {
      const caseRecord = occurrenceEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        result.matched &&
        !result.labelsCorrect
      );
    });
    expect(failingLabelPositives).toEqual([]);

    const failingNegatives = report.caseResults.filter((result) => {
      const caseRecord = occurrenceEvalCases.find((entry) => entry.id === result.caseId)!;
      return caseRecord.expected.status === "negative" && !result.unread && !result.negativeClean;
    });
    expect(failingNegatives).toEqual([]);

    expect(report.scores.unreadCount).toBe(0);
    expect(report.scores.recall).toBe(1);
    expect(report.scores.negativeCasePassRate).toBe(1);
    expect(report.scores.precision).toBe(1);
    expect(report.scores.denominators.exhaustiveScopedFindings).toBeGreaterThan(0);
  });
});
