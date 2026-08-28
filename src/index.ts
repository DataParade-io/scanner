export {
  createDefaultScanConfiguration,
  scan,
} from "./core/pipeline/orchestrator";
export type { OrchestratorScanResult } from "./core/pipeline/orchestrator-result";

export {
  emitScanProgress,
  finalizeDeterministicScanResult,
  runDeterministicScanPhases,
} from "./core/pipeline/deterministic-scan";
export type {
  DeterministicScanWork,
  FinalizeDeterministicScanInput,
} from "./core/pipeline/deterministic-scan";

export { buildDiagramGraphFromScanResult } from "./core/pipeline/graph-mapping";
export { collectEvalFindings } from "./core/pipeline/collect-eval-findings";
export { stableComponentKey } from "./core/pipeline/stable-component-ids";
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
