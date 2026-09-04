import type { EvalLayer } from "../types";
import type { EligibilityReason, PathEligibilityOutcome } from "../../../src/ingest/eligibility";

export interface LayerEligibilityLedger {
  layer: EvalLayer;
  outcomes: PathEligibilityOutcome[];
}

export type EvidenceCoverageGrade = "full" | "partial" | "none";

export interface EntityEvidenceCoverage {
  entityKey: string;
  layer: EvalLayer;
  coverage: EvidenceCoverageGrade;
  eligible: boolean;
  locations: Array<{ path: string; reason: EligibilityReason }>;
}

export type EligibilityReasonCounts = Record<EligibilityReason, number>;

export function emptyReasonCounts(): EligibilityReasonCounts {
  return {
    successfully_processed: 0,
    unsupported_file_type_or_language: 0,
    excluded_by_configured_policy: 0,
    ignored_by_repository_default_policy: 0,
    sensitive_path_exclusion: 0,
    file_too_large: 0,
    file_count_cap_reached: 0,
    total_byte_cap_reached: 0,
    missing_or_path_contract_mismatch: 0,
    read_decode_error: 0,
    parse_or_layer_processing_error: 0,
  };
}

export function createLayerLedger(
  layer: EvalLayer,
  outcomes: PathEligibilityOutcome[],
): LayerEligibilityLedger {
  return { layer, outcomes };
}

export function countReasons(
  outcomes: PathEligibilityOutcome[],
): EligibilityReasonCounts {
  const counts = emptyReasonCounts();
  for (const outcome of outcomes) {
    counts[outcome.reason] += 1;
  }
  return counts;
}
