import { dataActionEvalCases } from "./cases";
import {
  auditAssertedRelayCorroboration,
  scanFixtureDataActionAssignments,
} from "./adapter";
import { scoreEvalCases } from "../../score";

describe("eval/layers/data-actions", () => {
  const fixtures = [...new Set(dataActionEvalCases.map((caseRecord) => caseRecord.fixture))];

  it("meets data-action layer expectations (subtype defaults + remaining gaps)", async () => {
    const scanned = await Promise.all(fixtures.map(scanFixtureDataActionAssignments));
    const scanResults = scanned.map((entry) => entry.scanResult);
    const report = scoreEvalCases(dataActionEvalCases, scanResults);

    const failingNegatives = report.caseResults.filter((result) => {
      const caseRecord = dataActionEvalCases.find((entry) => entry.id === result.caseId)!;
      return caseRecord.expected.status === "negative" && !result.unread && !result.negativeClean;
    });
    expect(failingNegatives).toEqual([]);

    expect(report.scores.unreadCount).toBe(0);
    expect(report.scores.negativeCasePassRate).toBe(1);

    // Positives without documentedGap must match (flipped in 1.3 when derivation passes).
    const failingLivePositives = report.caseResults.filter((result) => {
      const caseRecord = dataActionEvalCases.find((entry) => entry.id === result.caseId)!;
      return (
        caseRecord.expected.status === "positive" &&
        !caseRecord.expected.documentedGap &&
        !result.unread &&
        !result.matched
      );
    });
    expect(failingLivePositives).toEqual([]);

    // Intentional fixture subjects without detectable components remain gaps.
    const documentedGapMisses = report.caseResults.filter(
      (result) => result.documentedGap && !result.matched,
    );
    expect(documentedGapMisses.length).toBeGreaterThan(0);

    expect(report.scores.denominators.evaluablePositives).toBeGreaterThan(0);
    expect(report.scores.recall).toBeGreaterThan(0);

    const relayViolations = scanned.flatMap((entry) =>
      auditAssertedRelayCorroboration(entry.asserted),
    );
    expect(relayViolations).toEqual([]);
  });
});
