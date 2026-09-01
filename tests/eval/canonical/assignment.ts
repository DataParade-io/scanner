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

  const expectationById = new Map(
    expectations.map((expectation) => [expectation.id, expectation]),
  );

  function rolledUpDataItemExpectations(expectationIds: string[]): boolean {
    if (expectationIds.length <= 1) {
      return true;
    }
    const grouped = expectationIds.map((id) => expectationById.get(id)!);
    const layer = grouped[0]?.identity.layer;
    if (layer !== "data-items") {
      return false;
    }
    const identityKey = grouped[0]?.identity.identityKey;
    return grouped.every((expectation) => expectation.identity.identityKey === identityKey);
  }

  let ambiguous = false;
  for (const findingIds of findingsPerExpectation.values()) {
    if (findingIds.length > 1) {
      ambiguous = true;
      break;
    }
  }
  if (!ambiguous) {
    for (const expectationIds of expectationsPerFinding.values()) {
      if (expectationIds.length > 1 && !rolledUpDataItemExpectations(expectationIds)) {
        ambiguous = true;
        break;
      }
    }
  }

  if (ambiguous) {
    return {
      pairs: [],
      unmatchedExpectationIds: expectations.map((expectation) => expectation.id),
      unmatchedFindingIds: findings.map((finding) => finding.id),
      ambiguous: true,
    };
  }

  const pairs = candidatePairs;
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
    ambiguous: false,
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
