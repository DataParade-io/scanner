import type { CanonicalLayer } from "./canonical/types";

export type MetricComputabilityState =
  | "no_reviewed_scope"
  | "reviewed_scope_unprocessed"
  | "processed_scope_zero_predictions"
  | "migration_incomplete_or_not_ready"
  | "unscorable_provenance"
  | "computable";

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

export interface ScopeDenominators {
  reviewedScopeFileCount: number;
  processedScopeFileCount: number;
}

export type HeadlineMetricKind =
  | "recall"
  | "ancestorCategoryRecall"
  | "precision"
  | "negativeCasePassRate";

export interface MetricScore {
  state: MetricComputabilityState;
  value: number | null;
  numerator: number;
  denominator: number;
}

export interface MetricComputability {
  scope: ScopeDenominators;
  metrics: Record<HeadlineMetricKind, MetricScore>;
  locationlessFindingCount: number;
}

export interface LayerScores {
  recall: number | null;
  ancestorCategoryRecall: number | null;
  labelAccuracy: number | null;
  correctLabelRecall: number | null;
  precision: number | null;
  negativeCasePassRate: number | null;
  unreadCount: number;
  denominators: EvalScoreDenominators;
  metricComputability: MetricComputability;
}

export interface ExpectationOutcome {
  expectationId: string;
  unread: boolean;
  matched: boolean;
  labelsCorrect: boolean;
  negativeClean: boolean;
  documentedGap: boolean;
}

export interface LayerEvaluationReport {
  scores: LayerScores;
  assignment: import("./canonical/assignment").AssignmentResult;
  perExpectation: ExpectationOutcome[];
}

export interface ScopeEligibilityContext {
  reviewedScopeFiles: readonly string[];
  processedScopeFiles: readonly string[];
  locationlessFindingCount: number;
}

export interface ExpectationEvaluationMeta {
  id: string;
  unread: boolean;
  documentedGap: boolean;
  isNegative: boolean;
  isPositive: boolean;
  isRecallEvaluable: boolean;
  expectedLabels: readonly string[];
}

export interface LayerEvaluationInput {
  layer: CanonicalLayer;
  expectations: ReadonlyArray<
    import("./canonical/types").CanonicalGoldExpectation & { id: string }
  >;
  findings: ReadonlyArray<
    import("./canonical/types").CanonicalScannerFinding & { id: string }
  >;
  expectationMeta: ReadonlyArray<ExpectationEvaluationMeta>;
  exhaustiveScopeFiles?: readonly string[];
  eligibility?: ScopeEligibilityContext;
}

export type EvalLayer = CanonicalLayer;
