import { toPosixPath } from "./gitignore";

/** Locked reason set — KDATAP-1b2294 (keep distinct). */
export type EligibilityReason =
  | "successfully_processed"
  | "unsupported_file_type_or_language"
  | "excluded_by_configured_policy"
  | "ignored_by_repository_default_policy"
  | "sensitive_path_exclusion"
  | "file_too_large"
  | "file_count_cap_reached"
  | "total_byte_cap_reached"
  | "missing_or_path_contract_mismatch"
  | "read_decode_error"
  | "parse_or_layer_processing_error";

export type EligibilityStage = "ingest" | "layer";

export interface PathEligibilityOutcome {
  stage: EligibilityStage;
  path: string;
  reason: EligibilityReason;
}

export interface IngestResult {
  files: import("../core/types/file").FileInfo[];
  outcomes: PathEligibilityOutcome[];
}

export function normalizeEligibilityPath(filePath: string): string {
  return toPosixPath(filePath.replace(/^\.\/+/, "").replace(/\\/g, "/"));
}

export function isSuccessfullyProcessed(outcome: PathEligibilityOutcome): boolean {
  return outcome.reason === "successfully_processed";
}

export function ingestOutcome(
  path: string,
  reason: EligibilityReason,
): PathEligibilityOutcome {
  return {
    stage: "ingest",
    path: normalizeEligibilityPath(path),
    reason,
  };
}

export function layerOutcome(
  path: string,
  reason: EligibilityReason,
): PathEligibilityOutcome {
  return {
    stage: "layer",
    path: normalizeEligibilityPath(path),
    reason,
  };
}

export function recordIngestOutcome(
  outcomes: Map<string, PathEligibilityOutcome>,
  path: string,
  reason: EligibilityReason,
): void {
  const normalized = normalizeEligibilityPath(path);
  outcomes.set(normalized, ingestOutcome(normalized, reason));
}

export function outcomesMapToSortedArray(
  outcomes: Map<string, PathEligibilityOutcome>,
): PathEligibilityOutcome[] {
  return [...outcomes.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}
