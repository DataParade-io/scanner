import {
  assertedIdentitiesMatch,
  evidenceLocationsOverlap,
  sameEntityIdentity,
} from "./identity";
import { contractVersionsMatch } from "./contract";
import { graphStrictCorrectness } from "./graph/match";
import type { CanonicalGoldExpectation, CanonicalScannerFinding, EvidenceLocation } from "./types";

export interface ConceptCorrectness {
  exactLeaf: boolean;
  ancestorCategory: boolean;
}

function normalizeConcept(token: string): string {
  return token.trim().toLowerCase().replace(/-/g, "_").replace(/\s+/g, "_");
}

export function conceptCorrectness(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): ConceptCorrectness {
  const expectedLeaf = normalizeConcept(expectation.classification.conceptLeaf);
  const actualLeaf = normalizeConcept(finding.classification.conceptLeaf);
  const expectedAncestry = expectation.classification.conceptAncestry.map(normalizeConcept);

  const exactLeaf = expectedLeaf === actualLeaf;
  const ancestorCategory =
    !exactLeaf &&
    expectedAncestry.includes(actualLeaf) &&
    actualLeaf !== expectedLeaf;

  return { exactLeaf, ancestorCategory };
}

/**
 * Strict correctness uses asserted fields only — display and observed-token candidates
 * never participate.
 */
export function strictCorrectness(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  if (expectation.disposition !== "accepted") {
    return false;
  }
  if (!assertedIdentitiesMatch(expectation, finding)) {
    return false;
  }
  const { exactLeaf } = conceptCorrectness(expectation, finding);
  return exactLeaf;
}

export function observationsMatch(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  return strictCorrectness(expectation, finding);
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

function lineRangesOverlap(
  a: Pick<EvidenceLocation, "start_line" | "end_line">,
  b: Pick<EvidenceLocation, "start_line" | "end_line">,
): boolean {
  return a.start_line <= b.end_line && b.start_line <= a.end_line;
}

function componentClassificationsMatch(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  const exp = expectation.classification;
  const act = finding.classification;
  if (exp.componentType !== undefined && exp.componentType !== act.componentType) {
    return false;
  }
  if (
    exp.componentSubtype !== undefined &&
    exp.componentSubtype !== act.componentSubtype
  ) {
    return false;
  }
  return true;
}

function optionalAssertionsMatchForAssignment(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  const expected = expectation.optionalAssertion;
  if (!expected) {
    return true;
  }
  const actual = finding.optionalAssertion;
  if (expected.vendor !== undefined && actual?.vendor !== expected.vendor) {
    return false;
  }
  if (expected.instance !== undefined && actual?.instance !== expected.instance) {
    return false;
  }
  return true;
}

function isCollectionScopedEvidence(locations: EvidenceLocation[]): boolean {
  return locations.length > 1;
}

/**
 * Data-items require same file-path overlap. Line overlap when both sides have spans;
 * file-level overlap only when gold evidence is collection-scoped.
 */
export function dataItemsEvidenceOverlaps(
  expectationLocations: EvidenceLocation[],
  findingLocations: EvidenceLocation[],
): boolean {
  const collectionScoped = isCollectionScopedEvidence(expectationLocations);

  for (const expected of expectationLocations) {
    for (const actual of findingLocations) {
      if (normalizePath(expected.file_path) !== normalizePath(actual.file_path)) {
        continue;
      }
      if (collectionScoped) {
        return true;
      }
      if (lineRangesOverlap(expected, actual)) {
        return true;
      }
    }
  }
  return false;
}

function componentAssignmentCandidate(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  if (!componentClassificationsMatch(expectation, finding)) {
    return false;
  }
  if (!optionalAssertionsMatchForAssignment(expectation, finding)) {
    return false;
  }
  if (!evidenceLocationsOverlap(expectation.evidenceLocations, finding.evidenceLocations)) {
    return false;
  }
  return conceptCorrectness(expectation, finding).exactLeaf;
}

function dataActionsAssignmentCandidate(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  if (!sameEntityIdentity(expectation.identity, finding.identity)) {
    return false;
  }
  if (!evidenceLocationsOverlap(expectation.evidenceLocations, finding.evidenceLocations)) {
    return false;
  }
  return conceptCorrectness(expectation, finding).exactLeaf;
}

function dataItemsAssignmentCandidate(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  if (!sameEntityIdentity(expectation.identity, finding.identity)) {
    return false;
  }
  return dataItemsEvidenceOverlaps(
    expectation.evidenceLocations,
    finding.evidenceLocations,
  );
}

function personalDataAssignmentCandidate(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  if (!sameEntityIdentity(expectation.identity, finding.identity)) {
    return false;
  }
  if (!componentClassificationsMatch(expectation, finding)) {
    return false;
  }
  if (!optionalAssertionsMatchForAssignment(expectation, finding)) {
    return false;
  }
  return evidenceLocationsOverlap(expectation.evidenceLocations, finding.evidenceLocations);
}

/**
 * Layer-aware pairing predicate for one-to-one assignment.
 * Recall pairing does not require exact concept leaf on mentions/raw-hits; classification
 * is scored separately via conceptCorrectness on assigned pairs.
 */
export function assignmentCandidate(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  if (expectation.disposition !== "accepted") {
    return false;
  }
  return pairingCandidate(expectation, finding);
}

function dataFlowObservationCandidate(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  if (!sameEntityIdentity(expectation.identity, finding.identity)) {
    return false;
  }
  return evidenceLocationsOverlap(expectation.evidenceLocations, finding.evidenceLocations);
}

function pairingCandidate(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  if (!contractVersionsMatch(expectation, finding)) {
    return false;
  }

  switch (expectation.identity.layer) {
    case "components":
      return componentAssignmentCandidate(expectation, finding);
    case "data-actions":
      return dataActionsAssignmentCandidate(expectation, finding);
    case "data-items":
      return dataItemsAssignmentCandidate(expectation, finding);
    case "mentions":
    case "raw-hits":
      return personalDataAssignmentCandidate(expectation, finding);
    case "data-flows":
      return graphStrictCorrectness(expectation, finding);
    default:
      return false;
  }
}

function negativePairingCandidate(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  if (!contractVersionsMatch(expectation, finding)) {
    return false;
  }

  switch (expectation.identity.layer) {
    case "components":
      return componentAssignmentCandidate(expectation, finding);
    case "data-actions":
      return dataActionsAssignmentCandidate(expectation, finding);
    case "data-items":
      return dataItemsAssignmentCandidate(expectation, finding);
    case "mentions":
    case "raw-hits":
      return personalDataAssignmentCandidate(expectation, finding);
    case "data-flows":
      return dataFlowObservationCandidate(expectation, finding);
    default:
      return false;
  }
}

/** Negative-case probe: same topology rules without requiring accepted disposition. */
export function negativeObservationCandidate(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  return negativePairingCandidate(expectation, finding);
}
