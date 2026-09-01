import { assignmentCandidate } from "./match";
import type { CanonicalGoldExpectation, CanonicalScannerFinding } from "./types";

export interface AssignmentPair {
  expectationId: string;
  findingId: string;
}

export interface AssignmentResult {
  pairs: AssignmentPair[];
  unmatchedExpectationIds: string[];
  unmatchedFindingIds: string[];
  ambiguous: boolean;
}

function findingCouldMatchExpectation(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  return assignmentCandidate(expectation, finding);
}

/**
 * One-to-one assignment without guessing between indistinguishable candidates.
 * Colliding findings or expectations are excluded from pairing; other identities
 * in the same bucket may still match.
 */
export function assignOneToOne(
  expectations: Array<CanonicalGoldExpectation & { id: string }>,
  findings: Array<CanonicalScannerFinding & { id: string }>,
): AssignmentResult {
  const candidatePairs: AssignmentPair[] = [];

  for (const expectation of expectations) {
    for (const finding of findings) {
      if (findingCouldMatchExpectation(expectation, finding)) {
        candidatePairs.push({
          expectationId: expectation.id,
          findingId: finding.id,
        });
      }
    }
  }

  const expectationsPerFinding = new Map<string, string[]>();
  const findingsPerExpectation = new Map<string, string[]>();

  for (const pair of candidatePairs) {
    const byFinding = expectationsPerFinding.get(pair.findingId) ?? [];
    byFinding.push(pair.expectationId);
    expectationsPerFinding.set(pair.findingId, byFinding);

    const byExpectation = findingsPerExpectation.get(pair.expectationId) ?? [];
    byExpectation.push(pair.findingId);
    findingsPerExpectation.set(pair.expectationId, byExpectation);
  }

  const blockedFindingIds = new Set<string>();
  for (const [findingId, expectationIds] of expectationsPerFinding) {
    if (expectationIds.length > 1) {
      blockedFindingIds.add(findingId);
    }
  }

  const blockedExpectationIds = new Set<string>();
  for (const [expectationId, findingIds] of findingsPerExpectation) {
    if (findingIds.length > 1) {
      blockedExpectationIds.add(expectationId);
    }
  }

  const ambiguous = blockedFindingIds.size > 0 || blockedExpectationIds.size > 0;

  const pairs = candidatePairs.filter(
    (pair) =>
      !blockedFindingIds.has(pair.findingId) &&
      !blockedExpectationIds.has(pair.expectationId),
  );

  const matchedExpectationIds = new Set(pairs.map((pair) => pair.expectationId));
  const matchedFindingIds = new Set(pairs.map((pair) => pair.findingId));

  return {
    pairs,
    unmatchedExpectationIds: expectations
      .filter((expectation) => !matchedExpectationIds.has(expectation.id))
      .map((expectation) => expectation.id),
    unmatchedFindingIds: findings
      .filter((finding) => !matchedFindingIds.has(finding.id))
      .map((finding) => finding.id),
    ambiguous,
  };
}

export function oneFindingCannotSatisfyBoth(
  expectations: Array<CanonicalGoldExpectation & { id: string }>,
  finding: CanonicalScannerFinding & { id: string },
): boolean {
  const matches = expectations.filter((expectation) =>
    assignmentCandidate(expectation, finding),
  );
  return matches.length <= 1;
}
