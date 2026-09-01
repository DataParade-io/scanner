export { CANONICAL_CONTRACT_VERSION, contractVersionsMatch } from "./canonical/contract";
export type { ContractEnvelope } from "./canonical/contract";

export type {
  AcceptedCanonicalGoldExpectation,
  AssertedClassification,
  CanonicalDisposition,
  CanonicalEntityIdentity,
  CanonicalGoldExpectation,
  CanonicalLayer,
  CanonicalScannerFinding,
  EvidenceLocation,
  OptionalAssertion,
  ObservedTokenCandidate,
  ObservedTokenValidationState,
} from "./canonical/types";
export {
  isAcceptedEvaluablePositive,
  isFlowLayerRecord,
  scannerFindingHasEntityId,
} from "./canonical/types";

export { isEvalPathContractValid, normalizeEvalPath } from "./path";

export {
  assignOneToOne,
  oneFindingCannotSatisfyBoth,
} from "./canonical/assignment";
export type { AssignmentPair, AssignmentResult } from "./canonical/assignment";

export {
  assignmentCandidate,
  conceptCorrectness,
  observationsMatch,
  strictCorrectness,
} from "./canonical/match";
export type { ConceptCorrectness } from "./canonical/match";

export {
  assertedIdentitiesMatch,
  evidenceLocationsOverlap,
  sameEntityIdentity,
} from "./canonical/identity";

export {
  computeMetricComputability,
  rollupLayerComputabilitySummary,
  aggregateScopeDenominators,
} from "./canonical/computability";
export type {
  HeadlineMetricKind,
  LayerComputabilitySummary,
  MetricComputabilityState,
} from "./canonical/computability";

export { evaluateLayerBucket } from "./evaluate";
export type {
  ExpectationEvaluationMeta,
  ExpectationOutcome,
  LayerEvaluationInput,
  LayerEvaluationReport,
  LayerScores,
  ScopeEligibilityContext,
} from "./report-types";

export {
  adaptDetectedComponent,
  adaptDetectedDataFlow,
  adaptPersonalDataFinding,
  resolveScannerAdapterMapVersion,
} from "./canonical/scanner";
