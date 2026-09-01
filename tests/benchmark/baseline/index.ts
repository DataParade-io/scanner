export {
  BASELINE_ARTIFACT_SCHEMA_VERSION,
  CAPABILITY_COVERAGE_DISCLAIMER,
  ELIGIBILITY_REASON_SET_VERSION,
  GROUND_TRUTH_SCHEMA_VERSION,
} from "./contract";

export { buildBaselineArtifact, type BuildBaselineArtifactInput } from "./build-baseline-artifact";
export { buildBaselineFingerprint, type BuildFingerprintInput } from "./fingerprint";
export { renderBaselineMarkdown } from "./render-markdown";
export {
  collectAnnotationStatusCounts,
  collectCapabilityCoverageDiagnostic,
  collectGoldPopulation,
  collectMigrationIncompleteAccounting,
  collectReviewStateCounts,
} from "./collect-gold-stats";
export { collectMaterializedSources } from "./collect-materializations";
export {
  buildDeterministicScanConfig,
  digestDeterministicScanConfig,
} from "./deterministic-config";
export { buildEligibilityProfileFingerprint } from "./eligibility-profile";
export {
  digestCorpusGold,
  digestFile,
  digestSortedFiles,
  digestStableJson,
  sha256Digest,
  stableStringify,
  walkCorpusGoldFiles,
} from "./digests";

export {
  baselineArtifactSchema,
  parseBaselineArtifact,
  type AnnotationStatusCountBlock,
  type BaselineArtifact,
  type BaselineFingerprint,
  type BaselineReadinessEmbed,
  type BaselineSeries,
  type CapabilityCoverageDiagnostic,
  type DeterministicScanConfig,
  type EligibilityProfileFingerprint,
  type GoldPopulationStats,
  type InvariantVersions,
  type LayerGoldPopulation,
  type MaterializedSourceFingerprint,
  type MigrationIncompleteAccounting,
  type ReviewStateCountBlock,
} from "./types";
