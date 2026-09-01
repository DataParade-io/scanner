/** Baseline artifact envelope schema version. */
export const BASELINE_ARTIFACT_SCHEMA_VERSION = "baseline-artifact/1" as const;

/** Locked eligibility reason set — mirrors src/ingest/eligibility.ts (KDATAP-1b2294). */
export const ELIGIBILITY_REASON_SET_VERSION = "eligibility-reasons/1" as const;

/** Corpus ground-truth schema generation tracked via manifest annotation_version. */
export const GROUND_TRUTH_SCHEMA_VERSION = "ground-truth/1" as const;

export const CAPABILITY_COVERAGE_DISCLAIMER =
  "diagnostic_only_not_recall_denominator" as const;
