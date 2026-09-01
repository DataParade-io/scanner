import type {
  EvalLayer,
  EvalScoreDenominators,
  MetricComputability,
  MetricComputabilityState,
  MetricScore,
  ScopeDenominators,
} from "../types";

export type { MetricComputabilityState };

export type HeadlineMetricKind = "recall" | "precision" | "negativeCasePassRate";

export interface ComputeMetricComputabilityInput {
  layer: EvalLayer;
  denominators: EvalScoreDenominators;
  scope: ScopeDenominators;
  recall: number | null;
  precision: number | null;
  negativeCasePassRate: number | null;
  positiveCaseCount: number;
  unreadPositiveCount: number;
  negativeCaseCount: number;
  unreadNegativeCount: number;
  locationlessFindingCount: number;
}

function metricScore(
  state: MetricComputabilityState,
  value: number | null,
  numerator: number,
  denominator: number,
): MetricScore {
  return { state, value, numerator, denominator };
}

export function resolveRecallComputability(
  input: ComputeMetricComputabilityInput,
): MetricScore {
  const { denominators, recall, layer, positiveCaseCount, unreadPositiveCount } = input;
  const numerator = denominators.matchedPositives;
  const denominator = denominators.evaluablePositives;

  if (denominator > 0) {
    return metricScore("computable", recall, numerator, denominator);
  }

  if (layer === "data-flows" && positiveCaseCount > 0) {
    return metricScore("migration_incomplete_or_not_ready", null, numerator, denominator);
  }

  if (unreadPositiveCount > 0 && positiveCaseCount > 0) {
    return metricScore("reviewed_scope_unprocessed", null, numerator, denominator);
  }

  return metricScore("migration_incomplete_or_not_ready", null, numerator, denominator);
}

export function resolvePrecisionComputability(
  input: ComputeMetricComputabilityInput,
): MetricScore {
  const { denominators, precision, scope, locationlessFindingCount } = input;
  const numerator = denominators.exhaustiveScopedMatches;
  const denominator = denominators.exhaustiveScopedFindings;

  if (scope.reviewedScopeFileCount === 0) {
    return metricScore("no_reviewed_scope", null, numerator, denominator);
  }

  if (scope.processedScopeFileCount === 0) {
    return metricScore("reviewed_scope_unprocessed", null, numerator, denominator);
  }

  if (denominator > 0) {
    return metricScore("computable", precision, numerator, denominator);
  }

  if (locationlessFindingCount > 0) {
    return metricScore("unscorable_provenance", null, numerator, denominator);
  }

  return metricScore("processed_scope_zero_predictions", null, numerator, denominator);
}

export function resolveNegativeCaseComputability(
  input: ComputeMetricComputabilityInput,
): MetricScore {
  const { denominators, negativeCasePassRate, negativeCaseCount, unreadNegativeCount } = input;
  const numerator = denominators.negativeCasesPassed;
  const denominator = denominators.negativeCases;

  if (denominator > 0) {
    return metricScore("computable", negativeCasePassRate, numerator, denominator);
  }

  if (unreadNegativeCount > 0 && negativeCaseCount > 0) {
    return metricScore("reviewed_scope_unprocessed", null, numerator, denominator);
  }

  return metricScore("migration_incomplete_or_not_ready", null, numerator, denominator);
}

export function computeMetricComputability(
  input: ComputeMetricComputabilityInput,
): MetricComputability {
  return {
    scope: input.scope,
    locationlessFindingCount: input.locationlessFindingCount,
    metrics: {
      recall: resolveRecallComputability(input),
      precision: resolvePrecisionComputability(input),
      negativeCasePassRate: resolveNegativeCaseComputability(input),
    },
  };
}

export function aggregateScopeDenominators(scopes: ScopeDenominators[]): ScopeDenominators {
  return {
    reviewedScopeFileCount: scopes.reduce((sum, scope) => sum + scope.reviewedScopeFileCount, 0),
    processedScopeFileCount: scopes.reduce((sum, scope) => sum + scope.processedScopeFileCount, 0),
  };
}

export type LayerComputabilitySummary = "scorable" | "unscorable" | "empty";

export function rollupLayerComputabilitySummary(
  layer: EvalLayer,
  caseCount: number,
  metrics: MetricComputability["metrics"],
  provisional: boolean,
): LayerComputabilitySummary {
  if (caseCount === 0) {
    return "empty";
  }

  if (provisional) {
    return layer === "data-flows" ? "unscorable" : "scorable";
  }

  if (layer === "data-flows") {
    return "unscorable";
  }

  const anyComputable = Object.values(metrics).some((metric) => metric.state === "computable");
  if (anyComputable) {
    return "scorable";
  }

  return "empty";
}

export function emptyMetricComputability(): MetricComputability {
  const emptyScope: ScopeDenominators = {
    reviewedScopeFileCount: 0,
    processedScopeFileCount: 0,
  };
  const emptyInput: ComputeMetricComputabilityInput = {
    layer: "components",
    denominators: {
      evaluablePositives: 0,
      matchedPositives: 0,
      matchedWithCorrectLabels: 0,
      negativeCases: 0,
      negativeCasesPassed: 0,
      exhaustiveScopedFindings: 0,
      exhaustiveScopedMatches: 0,
    },
    scope: emptyScope,
    recall: null,
    precision: null,
    negativeCasePassRate: null,
    positiveCaseCount: 0,
    unreadPositiveCount: 0,
    negativeCaseCount: 0,
    unreadNegativeCount: 0,
    locationlessFindingCount: 0,
  };
  return computeMetricComputability(emptyInput);
}
