import { mentionEvalCases } from "./cases";
import { scanFixtureMentions } from "./adapter";
import { scoreEvalCases } from "../../score";

describe("eval/layers/mentions", () => {
  const fixtures = [...new Set(mentionEvalCases.map((caseRecord) => caseRecord.fixture))];

  it("meets mention layer ground-truth expectations", async () => {
    const scanResults = await Promise.all(fixtures.map(scanFixtureMentions));
    const report = scoreEvalCases(mentionEvalCases, scanResults);

    const failingPositives = report.caseResults.filter((result) => {
      const caseRecord = mentionEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        !result.unread &&
        !result.matched
      );
    });
    expect(failingPositives).toEqual([]);

    const failingLabelPositives = report.caseResults.filter((result) => {
      const caseRecord = mentionEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        result.matched &&
        !result.labelsCorrect
      );
    });
    expect(failingLabelPositives).toEqual([]);

    const failingNegatives = report.caseResults.filter((result) => {
      const caseRecord = mentionEvalCases.find((entry) => entry.id === result.caseId)!;
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
