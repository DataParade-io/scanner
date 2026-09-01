import type { EligibilityReason } from "../../src/ingest/eligibility";
import {
  BASELINE_ARTIFACT_SCHEMA_VERSION,
  ELIGIBILITY_REASON_SET_VERSION,
  GROUND_TRUTH_SCHEMA_VERSION,
} from "../benchmark/baseline/contract";
import { SCORECARD_VECTOR_CONTRACT_VERSION } from "../benchmark/scorecard-vector";
import type { MetricComputabilityState } from "./types";
import { DIAGNOSTIC_LAYERS, HEADLINE_LAYERS } from "./score";

/** Contributor-facing evaluation docs checked by evaluation-docs-contract.spec.ts */
export const EVALUATION_DOC_PATHS = [
  "README.md",
  "CONTRIBUTING_AGENT.md",
  "project/wiki/index.md",
  "project/wiki/four-layer-evaluation.md",
  "project/wiki/eval-flywheel.md",
  "tests/eval/README.md",
  "tests/eval/ground-truth-schema.md",
  "tests/eval/canonical-representation.md",
  "tests/benchmark/README.md",
  "features/README.md",
] as const;

export type EvaluationDocPath = (typeof EVALUATION_DOC_PATHS)[number];

/** Substrings that must not appear in scoped evaluation docs. */
export const FORBIDDEN_DOC_SUBSTRINGS = [
  "pii_signals",
  "pii:",
  "pii_signal:",
  "five grade",
  "five-grade",
  "Five grade",
  "Five-grade",
  "conceptId === ruleId",
  "conceptId equals the rule id",
] as const;

/** Docs that must state raw-hits is diagnostic-only. */
export const DOCS_REQUIRING_DIAGNOSTIC_RAW_HITS = [
  "project/wiki/four-layer-evaluation.md",
  "tests/eval/ground-truth-schema.md",
  "tests/eval/README.md",
  "tests/benchmark/README.md",
] as const;

/** Docs that must state there is no cross-layer scalar. */
export const DOCS_REQUIRING_NO_CROSS_LAYER_SCALAR = [
  "project/wiki/four-layer-evaluation.md",
  "tests/eval/ground-truth-schema.md",
  "tests/benchmark/README.md",
] as const;

export const ELIGIBILITY_REASONS: readonly EligibilityReason[] = [
  "successfully_processed",
  "unsupported_file_type_or_language",
  "excluded_by_configured_policy",
  "ignored_by_repository_default_policy",
  "sensitive_path_exclusion",
  "file_too_large",
  "file_count_cap_reached",
  "total_byte_cap_reached",
  "missing_or_path_contract_mismatch",
  "read_decode_error",
  "parse_or_layer_processing_error",
] as const;

export const COMPUTABILITY_STATES: readonly MetricComputabilityState[] = [
  "no_reviewed_scope",
  "reviewed_scope_unprocessed",
  "processed_scope_zero_predictions",
  "migration_incomplete_or_not_ready",
  "unscorable_provenance",
  "computable",
] as const;

export const EVALUATION_CONTRACT_VERSIONS = {
  scorecardVector: SCORECARD_VECTOR_CONTRACT_VERSION,
  baselineArtifact: BASELINE_ARTIFACT_SCHEMA_VERSION,
  eligibilityReasonSet: ELIGIBILITY_REASON_SET_VERSION,
  groundTruthSchema: GROUND_TRUTH_SCHEMA_VERSION,
} as const;

export { DIAGNOSTIC_LAYERS, HEADLINE_LAYERS };
