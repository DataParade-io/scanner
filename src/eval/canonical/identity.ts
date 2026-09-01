import type {
  CanonicalEntityIdentity,
  CanonicalGoldExpectation,
  CanonicalScannerFinding,
  EvidenceLocation,
} from "./types";
import { contractVersionsMatch } from "./contract";

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

function lineRangesOverlap(
  a: Pick<EvidenceLocation, "start_line" | "end_line">,
  b: Pick<EvidenceLocation, "start_line" | "end_line">,
): boolean {
  return a.start_line <= b.end_line && b.start_line <= a.end_line;
}

export function evidenceLocationsOverlap(
  left: EvidenceLocation[],
  right: EvidenceLocation[],
): boolean {
  for (const a of left) {
    for (const b of right) {
      if (
        normalizePath(a.file_path) === normalizePath(b.file_path) &&
        lineRangesOverlap(a, b)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function sameEntityIdentity(
  left: CanonicalEntityIdentity,
  right: CanonicalEntityIdentity,
): boolean {
  return left.layer === right.layer && left.identityKey === right.identityKey;
}

function optionalAssertionsMatch(
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

function classificationsMatchForIdentity(
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

/**
 * Asserted identity comparison only — never reads displayText or observedTokenCandidates.
 */
export function assertedIdentitiesMatch(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  if (!contractVersionsMatch(expectation, finding)) {
    return false;
  }
  if (!sameEntityIdentity(expectation.identity, finding.identity)) {
    return false;
  }
  if (!classificationsMatchForIdentity(expectation, finding)) {
    return false;
  }
  if (!optionalAssertionsMatch(expectation, finding)) {
    return false;
  }
  if (!evidenceLocationsOverlap(expectation.evidenceLocations, finding.evidenceLocations)) {
    return false;
  }
  return true;
}
