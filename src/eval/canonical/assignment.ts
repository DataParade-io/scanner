import { assignmentCandidate } from "./match";
import type { CanonicalGoldExpectation, CanonicalScannerFinding, EvidenceLocation } from "./types";

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

interface SliceFinding extends CanonicalScannerFinding {
  id: string;
  parentFindingId: string;
}

function findingCouldMatchExpectation(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  return assignmentCandidate(expectation, finding);
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

function evidenceLocationKey(location: EvidenceLocation): string {
  return `${normalizePath(location.file_path)}:${location.start_line}:${location.end_line}`;
}

function expandDataItemFindingToSlices(
  finding: CanonicalScannerFinding & { id: string },
): SliceFinding[] {
  if (finding.evidenceLocations.length === 0) {
    return [{ ...finding, parentFindingId: finding.id }];
  }

  return finding.evidenceLocations.map((location) => ({
    ...finding,
    id: `${finding.id}::slice::${evidenceLocationKey(location)}`,
    parentFindingId: finding.id,
    evidenceLocations: [location],
  }));
}

function lineRangesOverlap(
  a: Pick<EvidenceLocation, "start_line" | "end_line">,
  b: Pick<EvidenceLocation, "start_line" | "end_line">,
): boolean {
  return a.start_line <= b.end_line && b.start_line <= a.end_line;
}

/**
 * Higher scores win identity-monopoly tie-breaks among slice pairs for the same
 * parent finding and identity key.
 */
function dataItemSlicePairStrength(
  expectation: CanonicalGoldExpectation,
  slice: CanonicalScannerFinding,
): number {
  let best = 0;
  for (const expected of expectation.evidenceLocations) {
    for (const actual of slice.evidenceLocations) {
      if (normalizePath(expected.file_path) !== normalizePath(actual.file_path)) {
        continue;
      }
      if (
        expected.start_line === actual.start_line &&
        expected.end_line === actual.end_line
      ) {
        best = Math.max(best, 3);
      } else if (lineRangesOverlap(expected, actual)) {
        best = Math.max(best, 2);
      } else if (expectation.evidenceLocations.length > 1) {
        best = Math.max(best, 1);
      }
    }
  }
  return best;
}

function collapseSliceAssignment(
  expectations: Array<CanonicalGoldExpectation & { id: string }>,
  findings: Array<CanonicalScannerFinding & { id: string }>,
  sliceAssignment: AssignmentResult,
  sliceToParent: Map<string, string>,
): AssignmentResult {
  const expectationById = new Map(expectations.map((entry) => [entry.id, entry]));
  const sliceById = new Map<string, SliceFinding>();
  for (const finding of findings) {
    for (const slice of expandDataItemFindingToSlices(finding)) {
      sliceById.set(slice.id, slice);
    }
  }

  const monopolyGroups = new Map<
    string,
    Array<{ expectationId: string; findingId: string; sliceId: string }>
  >();

  for (const pair of sliceAssignment.pairs) {
    const parentFindingId = sliceToParent.get(pair.findingId) ?? pair.findingId;
    const parentFinding = findings.find((entry) => entry.id === parentFindingId);
    if (!parentFinding) {
      continue;
    }

    const monopolyKey = `${parentFindingId}::${parentFinding.identity.identityKey}`;
    const group = monopolyGroups.get(monopolyKey) ?? [];
    group.push({
      expectationId: pair.expectationId,
      findingId: parentFindingId,
      sliceId: pair.findingId,
    });
    monopolyGroups.set(monopolyKey, group);
  }

  const pairs: AssignmentPair[] = [];
  for (const group of monopolyGroups.values()) {
    const ranked = [...group].sort((left, right) => {
      const leftExpectation = expectationById.get(left.expectationId)!;
      const rightExpectation = expectationById.get(right.expectationId)!;
      const leftSlice = sliceById.get(left.sliceId)!;
      const rightSlice = sliceById.get(right.sliceId)!;
      const leftScore = dataItemSlicePairStrength(leftExpectation, leftSlice);
      const rightScore = dataItemSlicePairStrength(rightExpectation, rightSlice);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return left.expectationId.localeCompare(right.expectationId);
    });
    pairs.push({
      expectationId: ranked[0].expectationId,
      findingId: ranked[0].findingId,
    });
  }

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
    ambiguous: sliceAssignment.ambiguous,
  };
}

/**
 * Data-items assignment: evidence-scoped slices unblock rolled-up findings that
 * match multiple gold rows, then identity monopoly caps one gold per parent
 * finding per identity key.
 */
export function assignDataItemsOneToOne(
  expectations: Array<CanonicalGoldExpectation & { id: string }>,
  findings: Array<CanonicalScannerFinding & { id: string }>,
): AssignmentResult {
  const slices: SliceFinding[] = [];
  const sliceToParent = new Map<string, string>();

  for (const finding of findings) {
    for (const slice of expandDataItemFindingToSlices(finding)) {
      slices.push(slice);
      sliceToParent.set(slice.id, finding.id);
    }
  }

  const sliceAssignment = assignOneToOne(expectations, slices);
  return collapseSliceAssignment(
    expectations,
    findings,
    sliceAssignment,
    sliceToParent,
  );
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
