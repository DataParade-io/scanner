import type { ContractEnvelope } from "./contract";

export type CanonicalLayer =
  | "components"
  | "data-flows"
  | "mentions"
  | "data-items"
  | "raw-hits";

export type ObservedTokenValidationState = "verified" | "unverified" | "contradicted";

export type CanonicalDisposition =
  | "accepted"
  | "needs_adjudication"
  | "rejected"
  | "migration_incomplete";

export interface EvidenceLocation {
  file_path: string;
  start_line: number;
  end_line: number;
}

export interface ObservedTokenCandidate {
  value: string;
  /** Index into `evidenceLocations` on the same record. */
  evidenceRef: number;
  provenance: string;
  validationState: ObservedTokenValidationState;
}

/** Layer-appropriate repo-local entity identity for one-to-one assignment. */
export interface CanonicalEntityIdentity {
  layer: CanonicalLayer;
  identityKey: string;
}

export interface AssertedClassification {
  conceptLeaf: string;
  conceptAncestry: readonly string[];
  componentType?: string;
  componentSubtype?: string;
}

export interface OptionalAssertion {
  vendor?: string;
  instance?: string;
}

export interface DisplayFields {
  displayText?: string;
}

export interface DeclaredCapabilitySupported {
  supported: boolean;
  reason?: string;
}

export interface DeclaredCapabilityCoverage {
  caseWeighted: number;
  distinctLeaf: number;
}

interface CanonicalRecordFields extends ContractEnvelope {
  identity: CanonicalEntityIdentity;
  classification: AssertedClassification;
  optionalAssertion?: OptionalAssertion;
  evidenceLocations: EvidenceLocation[];
  derivationLocations?: EvidenceLocation[];
  observedTokenCandidates?: ObservedTokenCandidate[];
  display?: DisplayFields;
  disposition: CanonicalDisposition;
  declaredCapabilitySupported?: DeclaredCapabilitySupported;
}

/** Canonical gold expectation — may carry migration bookkeeping `entityId`. */
export interface CanonicalGoldExpectation extends CanonicalRecordFields {
  /** Stable repository-local gold entity id (components only; migration bookkeeping). */
  entityId?: string;
}

/** Canonical scanner finding — never emits gold `entityId`. */
export type CanonicalScannerFinding = CanonicalRecordFields;

export interface AcceptedCanonicalGoldExpectation extends CanonicalGoldExpectation {
  disposition: "accepted";
}

export interface MigrationIncompleteRecord extends CanonicalGoldExpectation {
  disposition: "migration_incomplete";
}

export interface NeedsAdjudicationRecord extends CanonicalGoldExpectation {
  disposition: "needs_adjudication";
}

export function isAcceptedEvaluablePositive(
  record: CanonicalGoldExpectation,
): record is AcceptedCanonicalGoldExpectation {
  return (
    record.disposition === "accepted" &&
    record.classification.conceptLeaf.trim().length > 0
  );
}

export function isMigrationIncomplete(
  record: CanonicalGoldExpectation,
): record is MigrationIncompleteRecord {
  return record.disposition === "migration_incomplete";
}

export function isNeedsAdjudication(
  record: CanonicalGoldExpectation,
): record is NeedsAdjudicationRecord {
  return record.disposition === "needs_adjudication";
}

export function scannerFindingHasEntityId(
  finding: CanonicalScannerFinding,
): finding is CanonicalScannerFinding & { entityId: string } {
  return "entityId" in finding && (finding as { entityId?: string }).entityId !== undefined;
}
