import { dataActionEvalCases } from "./cases";
import {
  auditAssertedRelayCorroboration,
  scanFixtureDataActionAssignments,
} from "./adapter";
import { scoreEvalCases } from "../../score";

describe("eval/layers/data-actions", () => {
  const fixtures = [...new Set(dataActionEvalCases.map((caseRecord) => caseRecord.fixture))];

  it("meets data-action layer ground-truth expectations (documentedGap until derivation)", async () => {
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

    // documentedGap positives still count in recall; derivation (1.1–1.3) has not landed.
    const documentedGapMisses = report.caseResults.filter(
      (result) => result.documentedGap && !result.matched,
    );
    expect(documentedGapMisses.length).toBeGreaterThan(0);
    expect(report.scores.denominators.evaluablePositives).toBeGreaterThan(0);
    expect(report.scores.recall).toBe(0);

    // No asserted verbs yet → no in-scope findings (precision N/A until derivation emits).
    expect(report.scores.precision).toBeNull();
    expect(report.scores.denominators.exhaustiveScopedFindings).toBe(0);

    const relayViolations = scanned.flatMap((entry) =>
      auditAssertedRelayCorroboration(entry.asserted),
    );
    expect(relayViolations).toEqual([]);
  });
});
