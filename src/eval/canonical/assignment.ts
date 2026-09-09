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

function evidenceOverlapStrength(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): number {
  let best = 0;
  for (const expected of expectation.evidenceLocations) {
    for (const actual of finding.evidenceLocations) {
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
      } else {
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
  const pairs: AssignmentPair[] = sliceAssignment.pairs.map((pair) => ({
    expectationId: pair.expectationId,
    findingId: sliceToParent.get(pair.findingId) ?? pair.findingId,
  }));

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

interface ScoredAssignmentPair extends AssignmentPair {
  strength: number;
}

function assignDataItemSlicesOneToOne(
  expectations: Array<CanonicalGoldExpectation & { id: string }>,
  slices: Array<SliceFinding & { id: string }>,
): AssignmentResult {
  const blockedExpectationIds = new Set<string>();
  for (const expectation of expectations) {
    const parentsPerSliceKey = new Map<string, Set<string>>();
    for (const slice of slices) {
      if (!findingCouldMatchExpectation(expectation, slice)) {
        continue;
      }
      const sliceKey = evidenceLocationKey(slice.evidenceLocations[0]);
      const parents = parentsPerSliceKey.get(sliceKey) ?? new Set<string>();
      parents.add(slice.parentFindingId);
      parentsPerSliceKey.set(sliceKey, parents);
    }
    for (const parents of parentsPerSliceKey.values()) {
      if (parents.size > 1) {
        blockedExpectationIds.add(expectation.id);
        break;
      }
    }
  }

  const scoredPairs: ScoredAssignmentPair[] = [];

  for (const expectation of expectations) {
    if (blockedExpectationIds.has(expectation.id)) {
      continue;
    }
    let bestStrength = 0;
    for (const slice of slices) {
      if (!findingCouldMatchExpectation(expectation, slice)) {
        continue;
      }
      bestStrength = Math.max(
        bestStrength,
        evidenceOverlapStrength(expectation, slice),
      );
    }

    if (bestStrength === 0) {
      continue;
    }

    for (const slice of slices) {
      if (!findingCouldMatchExpectation(expectation, slice)) {
        continue;
      }
      const strength = evidenceOverlapStrength(expectation, slice);
      if (strength !== bestStrength) {
        continue;
      }
      scoredPairs.push({
        expectationId: expectation.id,
        findingId: slice.id,
        strength,
      });
    }
  }

  scoredPairs.sort((left, right) => {
    if (right.strength !== left.strength) {
      return right.strength - left.strength;
    }
    const expectationCmp = left.expectationId.localeCompare(right.expectationId);
    if (expectationCmp !== 0) {
      return expectationCmp;
    }
    return left.findingId.localeCompare(right.findingId);
  });

  const usedExpectationIds = new Set<string>();
  const usedSliceIds = new Set<string>();
  const pairs: AssignmentPair[] = [];
  let competingExpectationsPerSlice = 0;

  for (const pair of scoredPairs) {
    if (usedExpectationIds.has(pair.expectationId)) {
      continue;
    }
    if (usedSliceIds.has(pair.findingId)) {
      competingExpectationsPerSlice += 1;
      continue;
    }
    pairs.push({
      expectationId: pair.expectationId,
      findingId: pair.findingId,
    });
    usedExpectationIds.add(pair.expectationId);
    usedSliceIds.add(pair.findingId);
  }

  const expectationById = new Map(expectations.map((entry) => [entry.id, entry]));
  const assignedExpectationBySlice = new Map(
    pairs.map((pair) => [pair.findingId, pair.expectationId]),
  );

  for (const expectation of expectations) {
    if (
      blockedExpectationIds.has(expectation.id) ||
      usedExpectationIds.has(expectation.id)
    ) {
      continue;
    }

    let bestStrength = 0;
    const candidateSliceIds: string[] = [];
    for (const slice of slices) {
      if (!findingCouldMatchExpectation(expectation, slice)) {
        continue;
      }
      const strength = evidenceOverlapStrength(expectation, slice);
      if (strength === 0) {
        continue;
      }
      if (strength > bestStrength) {
        bestStrength = strength;
        candidateSliceIds.length = 0;
        candidateSliceIds.push(slice.id);
      } else if (strength === bestStrength) {
        candidateSliceIds.push(slice.id);
      }
    }

    for (const sliceId of candidateSliceIds) {
      if (!usedSliceIds.has(sliceId)) {
        continue;
      }
      const assignedExpectationId = assignedExpectationBySlice.get(sliceId);
      if (!assignedExpectationId) {
        continue;
      }
      const assignedExpectation = expectationById.get(assignedExpectationId);
      if (
        assignedExpectation?.identity.identityKey !==
        expectation.identity.identityKey
      ) {
        continue;
      }
      pairs.push({
        expectationId: expectation.id,
        findingId: sliceId,
      });
      usedExpectationIds.add(expectation.id);
      competingExpectationsPerSlice -= 1;
      break;
    }
  }

  const matchedExpectationIds = new Set(pairs.map((pair) => pair.expectationId));
  const matchedSliceIds = new Set(pairs.map((pair) => pair.findingId));

  return {
    pairs,
    unmatchedExpectationIds: expectations
      .filter((expectation) => !matchedExpectationIds.has(expectation.id))
      .map((expectation) => expectation.id),
    unmatchedFindingIds: slices
      .filter((slice) => !matchedSliceIds.has(slice.id))
      .map((slice) => slice.id),
    ambiguous:
      blockedExpectationIds.size > 0 || competingExpectationsPerSlice > 0,
  };
}

/**
 * Rolled personal-data assignment: evidence-scoped slices let rolled-up
 * findings credit each accepted gold row that overlaps a distinct evidence
 * location (or co-located duplicate rows on the same slice).
 */
function assignRolledPersonalDataOneToOne(
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

  const sliceAssignment = assignDataItemSlicesOneToOne(expectations, slices);
  return collapseSliceAssignment(
    expectations,
    findings,
    sliceAssignment,
    sliceToParent,
  );
}

/** @see assignRolledPersonalDataOneToOne */
export const assignDataItemsOneToOne = assignRolledPersonalDataOneToOne;

/** Mentions share the same rolled-finding slice assignment as data-items. */
export const assignMentionsOneToOne = assignRolledPersonalDataOneToOne;

/**
 * Data-flow assignment: when duplicate gold rows match one finding, credit the
 * strongest evidence overlap instead of blocking the finding entirely.
 * Findings matching multiple gold rows still block the expectation (contract).
 */
export function assignDataFlowsOneToOne(
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

  const expectationById = new Map(expectations.map((entry) => [entry.id, entry]));
  const findingById = new Map(findings.map((entry) => [entry.id, entry]));
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

  const blockedExpectationIds = new Set<string>();
  for (const [expectationId, findingIds] of findingsPerExpectation) {
    if (findingIds.length > 1) {
      blockedExpectationIds.add(expectationId);
    }
  }

  const pairs: AssignmentPair[] = [];
  let competingExpectationsPerFinding = 0;

  for (const [findingId, expectationIds] of expectationsPerFinding) {
    const eligibleExpectationIds = expectationIds.filter(
      (expectationId) => !blockedExpectationIds.has(expectationId),
    );
    if (eligibleExpectationIds.length === 0) {
      continue;
    }

    if (eligibleExpectationIds.length > 1) {
      competingExpectationsPerFinding += 1;
    }

    const finding = findingById.get(findingId)!;
    const ranked = [...eligibleExpectationIds].sort((leftId, rightId) => {
      const leftScore = evidenceOverlapStrength(
        expectationById.get(leftId)!,
        finding,
      );
      const rightScore = evidenceOverlapStrength(
        expectationById.get(rightId)!,
        finding,
      );
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return leftId.localeCompare(rightId);
    });

    pairs.push({
      expectationId: ranked[0],
      findingId,
    });
  }

  const ambiguous =
    blockedExpectationIds.size > 0 || competingExpectationsPerFinding > 0;
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
