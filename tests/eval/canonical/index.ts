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
  hasFlowEndpoints,
  isAcceptedEvaluablePositive,
  isFlowLayerRecord,
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
  assignmentCandidate,
  negativeObservationCandidate,
  dataItemsEvidenceOverlaps,
} from "./match";
export type { ConceptCorrectness } from "./match";

export { evaluateCanonical } from "./evaluate";

export {
  computeMetricComputability,
  emptyMetricComputability,
  resolvePrecisionComputability,
  resolveRecallComputability,
  resolveNegativeCaseComputability,
  rollupLayerComputabilitySummary,
  aggregateScopeDenominators,
} from "./computability";
export type {
  ComputeMetricComputabilityInput,
  HeadlineMetricKind as CanonicalHeadlineMetricKind,
  LayerComputabilitySummary,
  MetricComputabilityState,
} from "./computability";

export {
  canonicalFindingFromLayerFinding,
  canonicalGoldFromEvalCase,
  findingsForEvalLayer,
} from "./bridge";

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
  computeStrictRecallFromAssignment,
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
  CONVERSION_KINDS,
  annotationRecordToLegacyInput,
  buildAnnotationCanonicalBlock,
  buildComponentMigrationLedger,
  buildComponentMigrationLedgerEntry,
  classifyComponentMigrationBucket,
  listAcceptedComponentAnnotations,
  loadLegacyGoldRecord,
} from "./compat";
export type {
  CompatLoadResult,
  ConversionKind,
  ComponentMigrationBucket,
  ComponentMigrationLedger,
  ComponentMigrationLedgerEntry,
  LegacyGoldProvenance,
  LegacyGoldRecord,
  LoadLegacyGoldOptions,
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
} from "./concept-map";
export type { PersonalDataConceptMap, PersonalDataConceptMapEntry } from "./concept-map";

export {
  loadCanonicalGoldFromAnnotation,
  loadCanonicalGoldFromAnnotations,
  loadCanonicalGoldFromEvalCase,
  loadCanonicalGoldFromLegacyRecord,
  evalCaseToLegacyInput,
} from "./gold";

export {
  adaptDetectedComponent,
  adaptDetectedDataFlow,
  adaptPersonalDataFinding,
  clearScannerAdapterMapVersionCacheForTest,
  componentScannerIdentityKey,
  dataFlowScannerIdentityKey,
  extractPersonalDataRuleId,
  resolveScannerAdapterMapVersion,
} from "./scanner";

export * from "./graph";
