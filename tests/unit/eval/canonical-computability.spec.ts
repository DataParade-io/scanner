import {
  computeMetricComputability,
  resolvePrecisionComputability,
  resolveRecallComputability,
} from "../../../src/eval/canonical/computability";
import type { EvalScoreDenominators } from "../../eval/types";

function emptyDenominators(
  partial: Partial<EvalScoreDenominators> = {},
): EvalScoreDenominators {
  return {
    evaluablePositives: 0,
    matchedPositives: 0,
    matchedWithCorrectLabels: 0,
    matchedAncestorCategory: 0,
    negativeCases: 0,
    negativeCasesPassed: 0,
    exhaustiveScopedFindings: 0,
    exhaustiveScopedMatches: 0,
    ...partial,
  };
}

describe("metric computability resolvers", () => {
  it("marks recall computable when evaluable positives exist", () => {
    const result = resolveRecallComputability({
      layer: "mentions",
      denominators: emptyDenominators({ evaluablePositives: 3, matchedPositives: 2 }),
      scope: { reviewedScopeFileCount: 0, processedScopeFileCount: 0 },
      recall: 2 / 3,
      precision: null,
      negativeCasePassRate: null,
      positiveCaseCount: 3,
      unreadPositiveCount: 0,
      negativeCaseCount: 0,
      unreadNegativeCount: 0,
      locationlessFindingCount: 0,
    });

    expect(result.state).toBe("computable");
    expect(result.denominator).toBe(3);
  });

  it("marks data-flow recall as migration incomplete", () => {
    const result = resolveRecallComputability({
      layer: "data-flows",
      denominators: emptyDenominators(),
      scope: { reviewedScopeFileCount: 1, processedScopeFileCount: 1 },
      recall: null,
      precision: 0,
      negativeCasePassRate: null,
      positiveCaseCount: 2,
      unreadPositiveCount: 0,
      negativeCaseCount: 0,
      unreadNegativeCount: 0,
      locationlessFindingCount: 0,
    });

    expect(result.state).toBe("migration_incomplete_or_not_ready");
  });

  it("distinguishes precision no reviewed scope from zero predictions", () => {
    const noScope = resolvePrecisionComputability({
      layer: "mentions",
      denominators: emptyDenominators(),
      scope: { reviewedScopeFileCount: 0, processedScopeFileCount: 0 },
      recall: 1,
      precision: null,
      negativeCasePassRate: null,
      positiveCaseCount: 1,
      unreadPositiveCount: 0,
      negativeCaseCount: 0,
      unreadNegativeCount: 0,
      locationlessFindingCount: 0,
    });
    const zeroPredictions = resolvePrecisionComputability({
      layer: "mentions",
      denominators: emptyDenominators(),
      scope: { reviewedScopeFileCount: 2, processedScopeFileCount: 2 },
      recall: 1,
      precision: null,
      negativeCasePassRate: null,
      positiveCaseCount: 1,
      unreadPositiveCount: 0,
      negativeCaseCount: 0,
      unreadNegativeCount: 0,
      locationlessFindingCount: 0,
    });

    expect(noScope.state).toBe("no_reviewed_scope");
    expect(zeroPredictions.state).toBe("processed_scope_zero_predictions");
    expect(zeroPredictions.denominator).toBe(0);
  });

  it("marks precision unscorable when only locationless findings exist in processed scope", () => {
    const result = resolvePrecisionComputability({
      layer: "components",
      denominators: emptyDenominators(),
      scope: { reviewedScopeFileCount: 1, processedScopeFileCount: 1 },
      recall: null,
      precision: null,
      negativeCasePassRate: null,
      positiveCaseCount: 0,
      unreadPositiveCount: 0,
      negativeCaseCount: 0,
      unreadNegativeCount: 0,
      locationlessFindingCount: 2,
    });

    expect(result.state).toBe("unscorable_provenance");
  });

  it("computes full metric block with independent recall and precision states", () => {
    const block = computeMetricComputability({
      layer: "mentions",
      denominators: emptyDenominators({ evaluablePositives: 2, matchedPositives: 1 }),
      scope: { reviewedScopeFileCount: 0, processedScopeFileCount: 0 },
      recall: 0.5,
      precision: null,
      negativeCasePassRate: null,
      positiveCaseCount: 2,
      unreadPositiveCount: 0,
      negativeCaseCount: 0,
      unreadNegativeCount: 0,
      locationlessFindingCount: 0,
    });

    expect(block.metrics.recall.state).toBe("computable");
    expect(block.metrics.precision.state).toBe("no_reviewed_scope");
  });
});
