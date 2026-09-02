export {
  CANONICAL_CONTRACT_VERSION,
  SYNTHETIC_ADAPTER_MAP_VERSION,
  stampEnvelope,
  contractVersionsMatch,
} from "../../../src/eval/canonical/contract";
export type { ContractEnvelope } from "../../../src/eval/canonical/contract";

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
} from "../../../src/eval/canonical/types";
export {
  hasFlowEndpoints,
  isAcceptedEvaluablePositive,
  isFlowLayerRecord,
  isMigrationIncomplete,
  isNeedsAdjudication,
  scannerFindingHasEntityId,
} from "../../../src/eval/canonical/types";

export {
  assertedIdentitiesMatch,
  evidenceLocationsOverlap,
  sameEntityIdentity,
} from "../../../src/eval/canonical/identity";

export {
  conceptCorrectness,
  observationsMatch,
  strictCorrectness,
  assignmentCandidate,
  negativeObservationCandidate,
  dataItemsEvidenceOverlaps,
} from "../../../src/eval/canonical/match";
export type { ConceptCorrectness } from "../../../src/eval/canonical/match";

export { evaluateCanonical } from "./evaluate-fixture";

export {
  computeMetricComputability,
  emptyMetricComputability,
  resolvePrecisionComputability,
  resolveRecallComputability,
  resolveNegativeCaseComputability,
  rollupLayerComputabilitySummary,
  aggregateScopeDenominators,
} from "../../../src/eval/canonical/computability";
export type {
  ComputeMetricComputabilityInput,
  HeadlineMetricKind as CanonicalHeadlineMetricKind,
  LayerComputabilitySummary,
  MetricComputabilityState,
} from "../../../src/eval/canonical/computability";

export {
  canonicalFindingFromLayerFinding,
  canonicalGoldFromEvalCase,
  findingsForEvalLayer,
} from "./bridge";

export {
  assignOneToOne,
  oneFindingCannotSatisfyBoth,
} from "../../../src/eval/canonical/assignment";
export type { AssignmentPair, AssignmentResult } from "../../../src/eval/canonical/assignment";

export {
  acceptedEvaluablePositives,
  computeBaselineMetrics,
  computeCapabilityCoverage,
  computeEvidenceCoverage,
  computeStrictRecall,
  computeStrictRecallFromAssignment,
  computeVendorResolution,
  declaredCapabilityUnsupported,
} from "../../../src/eval/canonical/metrics";
export type {
  BaselineMetricsResult,
  CapabilityCoverageResult,
  EvidenceCoverageResult,
  StrictRecallResult,
  VendorResolutionMetrics,
} from "../../../src/eval/canonical/metrics";

export {
  buildAcceptedGoldExpectation,
  buildFlowFinding,
  buildFlowGoldExpectation,
  buildMigrationIncompleteRecord,
  buildNeedsAdjudicationRecord,
  buildScannerFinding,
  componentIdentity,
  nextSyntheticId,
  resetSyntheticIds,
  sampleEvidence,
  withId,
} from "./builders";
export type { BuildFindingInput, BuildFlowFindingInput, BuildFlowGoldInput, BuildGoldInput } from "./builders";

export {
  LEGACY_SOURCE_CONTRACT_VERSION,
  buildAnnotationCanonicalBlock,
  buildComponentMigrationLedger,
  buildComponentMigrationLedgerEntry,
  classifyComponentMigrationBucket,
  listAcceptedComponentAnnotations,
} from "./compat";
export type {
  ConversionKind,
  ComponentMigrationBucket,
  ComponentMigrationLedger,
  ComponentMigrationLedgerEntry,
  MigrationDiagnostic,
} from "./compat";

export {
  clearPersonalDataConceptMapCacheForTest,
  loadPersonalDataConceptMap,
  ruleIdToAncestry,
  ruleIdToConceptLeaf,
  tryRuleIdToConceptEntry,
  FORBIDDEN_CATEGORY_LEAVES,
  normalizeConceptToken,
  validatePersonalDataConceptMapDocument,
} from "../../../src/eval/canonical/concept-map";
export type { PersonalDataConceptMap, PersonalDataConceptMapEntry } from "../../../src/eval/canonical/concept-map";

export {
  loadCanonicalGoldFromAnnotation,
  loadCanonicalGoldFromAnnotations,
  loadCanonicalGoldFromEvalCase,
  evalCaseToAnnotationRecord,
} from "./gold";
export type { CanonicalGoldLoadResult, LoadCanonicalGoldOptions } from "./gold";

export {
  adaptDetectedComponent,
  adaptDetectedDataFlow,
  adaptPersonalDataFinding,
  clearScannerAdapterMapVersionCacheForTest,
  componentScannerIdentityKey,
  dataFlowScannerIdentityKey,
  extractPersonalDataRuleId,
  resolveScannerAdapterMapVersion,
} from "../../../src/eval/canonical/scanner";

export * from "../../../src/eval/canonical/graph";

export { evaluateLayerBucket } from "../../../src/eval/evaluate";
