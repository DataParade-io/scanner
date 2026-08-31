import { assertedIdentitiesMatch } from "./identity";
import type { CanonicalGoldExpectation, CanonicalScannerFinding } from "./types";

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
