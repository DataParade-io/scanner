export {
  createDefaultScanConfiguration,
  scan,
} from "./core/pipeline/orchestrator";
export type {
  OrchestratorScanResult,
  ScanDataItem,
  ScanOccurrence,
} from "./core/pipeline/orchestrator-result";

export {
  emitScanProgress,
  finalizeDeterministicScanResult,
  runDeterministicScanPhases,
} from "./core/pipeline/deterministic-scan";
export { enrichOrchestratorResultWithPersonalDataLayers } from "./core/pipeline/enrich-personal-data-layers";
export { buildScanPersonalDataLayers } from "./core/pipeline/build-scan-personal-data-layers";
export type {
  DeterministicScanWork,
  FinalizeDeterministicScanInput,
} from "./core/pipeline/deterministic-scan";

export { buildDiagramGraphFromScanResult, selectPrimaryDataAction } from "./core/pipeline/graph-mapping";
export {
  runGraphify,
  loadGraphifyGraph,
  type GraphifyGraph,
  type GraphifyNode,
  type GraphifyLink,
  type StructureGraphConfig,
  type StructureGraphInfo,
} from "./structure/graphify";
export {
  buildDataParadeGraph,
  writeKnowledgeGraph,
  DATAPARADE_GRAPH_FILE,
  DATAPARADE_GRAPH_SCHEMA,
  type DataParadeGraph,
  type DataParadeNode,
  type DataParadeLink,
} from "./graph/build-dataparade-graph";
export { collectEvalFindings } from "./core/pipeline/collect-eval-findings";
export { stableComponentKey, assignStableComponentIds } from "./core/pipeline/stable-component-ids";
export { sortDataFlowsDeterministically } from "./core/pipeline/sorting";
export type {
  CollectEvalFindingsResult,
  EvalFinding,
  EvalFindingsPayload,
} from "./core/pipeline/collect-eval-findings";

export {
  ingestFileSystem,
  resolveScanFilesystemEntry,
} from "./ingest/file-system";
export type { IngestOptions } from "./ingest/file-system";
export { isSensitiveEnvPath } from "./ingest/sensitive-paths";
export {
  gitignorePatternToRegex,
  gitignoreRulesForDir,
  isPathIgnored,
  toPosixPath,
} from "./ingest/gitignore";
export type { IgnoreRule } from "./ingest/gitignore";

export {
  DEFAULT_EXCLUDED_FILE_GLOBS,
  shouldSkipDirectoryName,
} from "./patterns/scan-exclusions";

export { appendTerraformBareProviderAttachmentFlows } from "./data-flow/terraform-flows";
export { dedupeDataFlows } from "./data-flow/dedupe";
export { loadClassifierConfig } from "./classifier/config";
export { DETECTABLE_PROPERTY_KEYS } from "./classifier/enhance-defaults";
export { runAnalyzers } from "./analyzers/registry";

export * from "./core/schema";
export * from "./core/types";
export type { ServiceSection } from "./core/sectioning/discover-service-sections";
export {
  discoverServiceSections,
  tagFindingsWithServiceSections,
} from "./core/sectioning/discover-service-sections";

export {
  DATA_ACTIONS,
  DATA_ACTION_ALIASES,
  DATA_ACTION_FRAMEWORK_ANCHORS,
  DATA_ACTION_SET,
  isDataAction,
  normalizeDataAction,
  normalizeDataActionToken,
  deriveFromTopology,
  STORAGE_SUBTYPES,
  deriveFromPatterns,
  pathsReferToSameFile,
  deriveFromSubtypes,
  SUBTYPE_STORE_SUBTYPES,
  TERRAFORM_GATEWAY_SUBTYPES,
  loadDataActionRuleCatalog,
  loadDataActionRules,
  clearDataActionRulesCacheForTest,
  ruleAppliesToLanguage,
  DATA_ACTION_RULE_LANGUAGES,
  mergeAssignmentsOntoComponents,
  mergeOneAssignment,
  readDataActions,
  hasVerb,
  runDataActionPhase,
} from "./data-actions";
export type {
  DataAction,
  DataActionFrameworkAnchor,
  DataActionPatternRule,
  DataActionRuleCatalog,
  DataActionRuleLanguage,
  DeriveFromPatternsOptions,
  RunDataActionPhaseOptions,
} from "./data-actions";

export {
  SENTIMENT_SOURCES,
  humanMessageRecordSchema,
  isRfc3339Utc,
  normalizeTimestampToRfc3339Utc,
  parseTimestampToDate,
} from "./sentiment/record";
export type { HumanMessageRecord, SentimentSource } from "./sentiment/record";
export {
  buildDedupKey,
  dedupeRecords,
} from "./sentiment/dedup";
export type { DedupStats } from "./sentiment/dedup";
export type {
  AdapterDiscoveryResult,
  AdapterExtractResult,
  SentimentAdapter,
  SkipCounter,
} from "./sentiment/adapter";
export { createSkipCounter } from "./sentiment/adapter";
export {
  loadScanState,
  recordScanWatermark,
  updateScanWatermark,
} from "./sentiment/scan-state";
export type { ScanState, ScanWatermark } from "./sentiment/scan-state";
export {
  SENTIMENT_FAMILIES,
  countMessage,
  hasPathLikeSuffix,
} from "./sentiment/counting";
export type {
  CountingOptions,
  FamilyCount,
  MessageCountResult,
  SentimentFamily,
} from "./sentiment/counting";
export {
  DEFAULT_EXCLUSION_THRESHOLDS,
  isPastedRegion,
  stripExcludedRegions,
} from "./sentiment/exclusions";
export type { ExclusionThresholds } from "./sentiment/exclusions";
export { loadSentimentWordList } from "./sentiment/word-lists";
export type { SentimentWordList } from "./sentiment/word-lists";
export {
  isInWindow,
  parseDayStart,
  parseWindowSpec,
  resolveWindow,
  validateTimeZone,
} from "./sentiment/windows";
export type {
  AbsoluteBounds,
  WindowBounds,
  WindowSpec,
} from "./sentiment/windows";
export { scanAdapter } from "./sentiment/scan";
export type { ScanResult } from "./sentiment/scan";
export {
  createClaudeCodeAdapter,
  decodeProjectDirName,
  doctorClaudeCode,
  extractClaudeCodeRecords,
  isInjectedText,
} from "./sentiment/adapters/claude-code";
export type { ClaudeCodeAdapterOptions, ClaudeCodeDoctorReport } from "./sentiment/adapters/claude-code";
export type { DiscoveredSession } from "./sentiment/adapter";



