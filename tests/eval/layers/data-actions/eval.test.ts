import { dataActionEvalCases } from "./cases";
import {
  auditAssertedRelayCorroboration,
  scanFixtureDataActionAssignments,
} from "./adapter";
import { scoreEvalCases } from "../../score";

describe("eval/layers/data-actions", () => {
  const fixtures = [...new Set(dataActionEvalCases.map((caseRecord) => caseRecord.fixture))];

  it("scores topology+pattern verbs; documentedGap remains until 1.3 gap flip", async () => {
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

    // Topology + patterns lift many verbs; subtype/gap flip waits on 1.3.
    const documentedGapMisses = report.caseResults.filter(
      (result) => result.documentedGap && !result.matched,
    );
    const documentedGapHits = report.caseResults.filter(
      (result) => result.documentedGap && result.matched,
    );
    expect(documentedGapMisses.length).toBeGreaterThan(0);
    expect(documentedGapHits.length).toBeGreaterThan(0);
    expect(report.scores.denominators.evaluablePositives).toBeGreaterThan(0);
    expect(report.scores.recall).toBeGreaterThan(0);
    expect(report.scores.recall).toBeLessThan(1);

    // Asserted verbs are in-scope findings; precision is computed when exhaustive scope applies.
    expect(report.scores.denominators.exhaustiveScopedFindings).toBeGreaterThan(0);

    const relayViolations = scanned.flatMap((entry) =>
      auditAssertedRelayCorroboration(entry.asserted),
    );
    expect(relayViolations).toEqual([]);
  });
});
