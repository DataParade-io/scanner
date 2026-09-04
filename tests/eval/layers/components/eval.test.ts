import { componentEvalCases } from "./cases";
import { scanFixtureComponents } from "./adapter";
import { scoreEvalCases } from "../../score";

describe("eval/layers/components", () => {
  const fixtures = [...new Set(componentEvalCases.map((caseRecord) => caseRecord.fixture))];

  it("meets component layer ground-truth expectations", async () => {
    const scanResults = await Promise.all(fixtures.map(scanFixtureComponents));
    const report = scoreEvalCases(componentEvalCases, scanResults);

    const failingNegatives = report.caseResults.filter((result) => {
      const caseRecord = componentEvalCases.find((entry) => entry.id === result.caseId)!;
      return caseRecord.expected.status === "negative" && !result.unread && !result.negativeClean;
    });
    expect(failingNegatives).toEqual([]);

    expect(report.scores.unreadCount).toBe(0);
    expect(report.scores.negativeCasePassRate).toBe(1);

    const typescriptCases = componentEvalCases.filter(
      (caseRecord) => caseRecord.fixture === "typescript-basic",
    );
    const typescriptReport = scoreEvalCases(typescriptCases, scanResults);
    expect(typescriptReport.scores.recall).toBe(1);

    const jvmCases = componentEvalCases.filter(
      (caseRecord) =>
        caseRecord.fixture === "jvm-manifests-basic" &&
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap,
    );
    const jvmReport = scoreEvalCases(jvmCases, scanResults);
    expect(jvmReport.scores.denominators.matchedPositives).toBe(0);

    const documentedGapMisses = report.caseResults.filter(
      (result) => result.documentedGap && !result.matched,
    );
    expect(documentedGapMisses.length).toBeGreaterThan(0);
    expect(report.scores.recall).toBeLessThan(1);

    expect(report.scores.precision).not.toBeNull();
    expect(report.scores.precision as number).toBeLessThan(1);
    expect(report.scores.denominators.exhaustiveScopedFindings).toBeGreaterThan(0);
  });
});
