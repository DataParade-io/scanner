/** Fixture evaluation types — aligns with tests/benchmark/schema.ts and ground-truth-schema.md */

export type EvalCaseStatus = "positive" | "negative" | "ambiguous";

export type EvalLayer =
  | "components"
  | "data-flows"
  | "raw-hits"
  | "data-items"
  | "mentions";

export interface EvalSubject {
  /** Layer identity, e.g. `asset:database` or `third_party:stripe` */
  key: string;
  name?: string;
}

export interface EvalEvidence {
  file_path: string;
  start_line: number;
  end_line: number;
}

export interface EvalExpected {
  status: EvalCaseStatus;
  labels: string[];
  /**
   * Marks a known scanner miss for reporting. Still counted in recall metrics;
   * CI gating excludes documented gaps separately.
   */
  documentedGap?: boolean;
}

export interface EvalCase {
  id: string;
  fixture: string;
  layer: EvalLayer;
  subject: EvalSubject;
  evidence: EvalEvidence;
  expected: EvalExpected;
  rationale: string;
  /**
   * Files exhaustively reviewed for this fixture. When set, scanner findings
   * with source locations in these files contribute to precision. Extra scanner
   * hits in this closed world are false positives; a missing vendor is not
   * recorded as a negative case.
   */
  exhaustiveScopeFiles?: string[];
  /** Promoted flow canonical block from corpus annotations (benchmark eval only). */
  flow_canonical?: import("../benchmark/schema").FlowAnnotationCanonical;
  /** Non-scoring flow candidate metadata preserved for canonical gold loading. */
  flowCandidate?: import("../benchmark/schema").FlowAnnotationCandidate;
}

export interface LayerFinding {
  key: string;
  labels: string[];
  sourceFilePaths: string[];
  sourceLines: Array<{
    file_path: string;
    start_line: number;
    end_line: number;
  }>;
  /**
   * When set, scoring only compares this finding to cases of the same layer.
   * Untagged findings (fixture adapters) participate in every layer of the
   * score call — fixture tests score one layer at a time.
   */
  layer?: EvalLayer;
}

export interface FixtureScanResult {
  fixture: string;
  findings: LayerFinding[];
  /** @deprecated Use eligibilityLedgers; not used by score.ts */
  scannedFiles: string[];
  eligibilityLedgers?: Partial<Record<EvalLayer, import("./eligibility/types").LayerEligibilityLedger>>;
}

export interface EvalScoreDenominators {
  evaluablePositives: number;
  matchedPositives: number;
  matchedWithCorrectLabels: number;
  matchedAncestorCategory: number;
  negativeCases: number;
  negativeCasesPassed: number;
  exhaustiveScopedFindings: number;
  exhaustiveScopedMatches: number;
}

export type MetricComputabilityState =
  | "no_reviewed_scope"
  | "reviewed_scope_unprocessed"
  | "processed_scope_zero_predictions"
  | "migration_incomplete_or_not_ready"
  | "unscorable_provenance"
  | "computable";

export interface ScopeDenominators {
  reviewedScopeFileCount: number;
  processedScopeFileCount: number;
}

export interface MetricScore {
  state: MetricComputabilityState;
  value: number | null;
  numerator: number;
  denominator: number;
}

export type HeadlineMetricKind =
  | "recall"
  | "ancestorCategoryRecall"
  | "precision"
  | "negativeCasePassRate";

export interface MetricComputability {
  scope: ScopeDenominators;
  metrics: Record<HeadlineMetricKind, MetricScore>;
  locationlessFindingCount: number;
}

export interface EvalScores {
  /** Null when there are no evaluable (read) positive cases */
  recall: number | null;
  /** Null when there are no evaluable positive cases; separate from exact-concept recall */
  ancestorCategoryRecall: number | null;
  /** Null when no positives matched */
  labelAccuracy: number | null;
  /** Null when there are no evaluable (read) positive cases */
  correctLabelRecall: number | null;
  /** Null when no exhaustive scope produced scoped findings */
  precision: number | null;
  /** Null when there are no evaluable (read) negative cases */
  negativeCasePassRate: number | null;
  unreadCount: number;
  denominators: EvalScoreDenominators;
  metricComputability: MetricComputability;
}

export interface EvalCaseResult {
  caseId: string;
  fixture: string;
  unread: boolean;
  matched: boolean;
  labelsCorrect: boolean;
  negativeClean: boolean;
  documentedGap: boolean;
}

export interface EvalScoreReport {
  scores: EvalScores;
  caseResults: EvalCaseResult[];
}
