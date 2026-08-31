export {
  CANONICAL_CONTRACT_VERSION,
  SYNTHETIC_ADAPTER_MAP_VERSION,
  stampEnvelope,
  contractVersionsMatch,
} from "./contract";
export type { ContractEnvelope } from "./contract";

export type {
  AcceptedCanonicalGoldExpectation,
  AssertedClassification,
  CanonicalDisposition,
  CanonicalEntityIdentity,
  CanonicalGoldExpectation,
  CanonicalLayer,
  CanonicalScannerFinding,
  DeclaredCapabilityCoverage,
  DeclaredCapabilitySupported,
  DisplayFields,
  EvidenceLocation,
  MigrationIncompleteRecord,
  NeedsAdjudicationRecord,
  ObservedTokenCandidate,
  ObservedTokenValidationState,
  OptionalAssertion,
} from "./types";
export {
  isAcceptedEvaluablePositive,
  isMigrationIncomplete,
  isNeedsAdjudication,
  scannerFindingHasEntityId,
} from "./types";

export {
  assertedIdentitiesMatch,
  evidenceLocationsOverlap,
  sameEntityIdentity,
} from "./identity";

export {
  conceptCorrectness,
  observationsMatch,
  strictCorrectness,
} from "./match";
export type { ConceptCorrectness } from "./match";

export {
  assignOneToOne,
  oneFindingCannotSatisfyBoth,
} from "./assignment";
export type { AssignmentPair, AssignmentResult } from "./assignment";

export {
  acceptedEvaluablePositives,
  computeBaselineMetrics,
  computeCapabilityCoverage,
  computeEvidenceCoverage,
  computeStrictRecall,
  computeVendorResolution,
  declaredCapabilityUnsupported,
} from "./metrics";
export type {
  BaselineMetricsResult,
  CapabilityCoverageResult,
  EvidenceCoverageResult,
  StrictRecallResult,
  VendorResolutionMetrics,
} from "./metrics";

export {
  buildAcceptedGoldExpectation,
  buildMigrationIncompleteRecord,
  buildNeedsAdjudicationRecord,
  buildScannerFinding,
  componentIdentity,
  nextSyntheticId,
  resetSyntheticIds,
  sampleEvidence,
  withId,
} from "./builders";
export type { BuildFindingInput, BuildGoldInput } from "./builders";
