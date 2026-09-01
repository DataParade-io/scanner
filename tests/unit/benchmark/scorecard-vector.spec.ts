import type { EvalCase, EvalScoreReport, EvalScores } from "../../eval/types";
import { computeMetricComputability } from "../../eval/canonical/computability";
import {
  aggregateEvalScores,
  assertNoCrossLayerScalar,
  buildScorecardLayerEntry,
  buildScorecardVector,
  HEADLINE_LAYERS,
  resolveLayerGate,
  SCORECARD_VECTOR_CONTRACT_VERSION,
} from "../../benchmark/scorecard-vector";

function withMetricComputability(
  scores: Omit<EvalScores, "metricComputability">,
  layer: EvalCase["layer"],
  options: {
    positiveCaseCount?: number;
    unreadPositiveCount?: number;
    negativeCaseCount?: number;
    unreadNegativeCount?: number;
    reviewedScopeFileCount?: number;
    processedScopeFileCount?: number;
    locationlessFindingCount?: number;
  } = {},
): EvalScores {
  const {
    positiveCaseCount = scores.denominators.evaluablePositives,
    unreadPositiveCount = 0,
    negativeCaseCount = scores.denominators.negativeCases,
    unreadNegativeCount = 0,
    reviewedScopeFileCount = scores.denominators.exhaustiveScopedFindings > 0 ? 1 : 0,
    processedScopeFileCount = scores.denominators.exhaustiveScopedFindings > 0 ? 1 : 0,
    locationlessFindingCount = 0,
  } = options;

  return {
    ...scores,
    metricComputability: computeMetricComputability({
      layer,
      denominators: scores.denominators,
      scope: { reviewedScopeFileCount, processedScopeFileCount },
      recall: scores.recall,
      precision: scores.precision,
      negativeCasePassRate: scores.negativeCasePassRate,
      positiveCaseCount,
      unreadPositiveCount,
      negativeCaseCount,
      unreadNegativeCount,
      locationlessFindingCount,
    }),
  };
}

function emptyReport(): EvalScoreReport {
  const scores = withMetricComputability(
    {
      recall: null,
      ancestorCategoryRecall: null,
      labelAccuracy: null,
      correctLabelRecall: null,
      precision: null,
      negativeCasePassRate: null,
      unreadCount: 0,
      denominators: {
        evaluablePositives: 0,
        matchedPositives: 0,
        matchedWithCorrectLabels: 0,
        matchedAncestorCategory: 0,
        negativeCases: 0,
        negativeCasesPassed: 0,
        exhaustiveScopedFindings: 0,
        exhaustiveScopedMatches: 0,
      },
    },
    "components",
  );
  return { scores, caseResults: [] };
}

function reportWithDenominators(
  layer: EvalCase["layer"],
  partial: Partial<EvalScoreReport["scores"]["denominators"]>,
  rates: Partial<Pick<EvalScoreReport["scores"], "recall" | "precision">> = {},
  computabilityOptions: Parameters<typeof withMetricComputability>[2] = {},
): EvalScoreReport {
  const denominators = {
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
  const scores = withMetricComputability(
    {
      recall:
        rates.recall ??
        (denominators.evaluablePositives === 0
          ? null
          : denominators.matchedPositives / denominators.evaluablePositives),
      ancestorCategoryRecall:
        denominators.evaluablePositives === 0
          ? null
          : denominators.matchedAncestorCategory / denominators.evaluablePositives,
      labelAccuracy: null,
      correctLabelRecall: null,
      precision:
        rates.precision ??
        (denominators.exhaustiveScopedFindings === 0
          ? null
          : denominators.exhaustiveScopedMatches / denominators.exhaustiveScopedFindings),
      negativeCasePassRate: null,
      unreadCount: 0,
      denominators,
    },
    layer,
    computabilityOptions,
  );
  return { scores, caseResults: [] };
}

function positiveCase(layer: EvalCase["layer"], id: string): EvalCase {
  return {
    id,
    fixture: "fixture-a",
    layer,
    subject: { key: `${layer}:${id}` },
    evidence: { file_path: "src/a.ts", start_line: 1, end_line: 1 },
    expected: { status: "positive", labels: ["label"] },
    rationale: "test",
  };
}

describe("scorecard-vector", () => {
  it("pools denominators across packets instead of averaging recall rates", () => {
    const aggregated = aggregateEvalScores([
      reportWithDenominators("mentions", { evaluablePositives: 10, matchedPositives: 8 }),
      reportWithDenominators("mentions", { evaluablePositives: 10, matchedPositives: 2 }),
    ]);

    expect(aggregated.recall).toBe(0.5);
    expect(aggregated.denominators.evaluablePositives).toBe(20);
    expect(aggregated.denominators.matchedPositives).toBe(10);
  });

  it("excludes raw-hits from headline vector keys", () => {
    const vector = buildScorecardVector({
      scannerGitSha: "abc123",
      generatedAt: "2026-08-31T00:00:00.000Z",
      reviewStates: ["accepted"],
      packets: [
        {
          repoKey: "packet-a",
          evalCases: [positiveCase("mentions", "m1")],
          layerScores: {
            mentions: reportWithDenominators("mentions", {
              evaluablePositives: 1,
              matchedPositives: 1,
            }),
            "raw-hits": reportWithDenominators("raw-hits", {
              evaluablePositives: 3,
              matchedPositives: 2,
            }),
          },
        },
      ],
    });

    expect(Object.keys(vector.layers).sort()).toEqual([...HEADLINE_LAYERS].sort());
    expect(vector.diagnostic["raw-hits"].scores.denominators.evaluablePositives).toBe(3);
    assertNoCrossLayerScalar(vector);
  });

  it("marks data-flows unscorable with pending gate and null recall", () => {
    const entry = buildScorecardLayerEntry(
      "data-flows",
      reportWithDenominators(
        "data-flows",
        {
          evaluablePositives: 0,
          exhaustiveScopedFindings: 4,
          exhaustiveScopedMatches: 0,
        },
        { precision: 0 },
        {
          positiveCaseCount: 2,
          reviewedScopeFileCount: 2,
          processedScopeFileCount: 2,
        },
      ),
      2,
      false,
    );

    expect(entry.computability.summary).toBe("unscorable");
    expect(entry.computability.unscorableReason).toBe("needs_adjudication");
    expect(entry.computability.metrics.recall.state).toBe("migration_incomplete_or_not_ready");
    expect(entry.computability.metrics.precision.state).toBe("computable");
    expect(entry.scores.recall).toBeNull();
    expect(entry.gate.status).toBe("pending");
    expect(entry.scores.precision).toBe(0);
  });

  it("keeps recall computable when precision has no reviewed scope", () => {
    const entry = buildScorecardLayerEntry(
      "mentions",
      reportWithDenominators(
        "mentions",
        { evaluablePositives: 2, matchedPositives: 1 },
        {},
        { reviewedScopeFileCount: 0, processedScopeFileCount: 0 },
      ),
      2,
      false,
    );

    expect(entry.computability.metrics.recall.state).toBe("computable");
    expect(entry.computability.metrics.precision.state).toBe("no_reviewed_scope");
    expect(entry.gate.status).toBe("scorable");
  });

  it("uses provisional gate when review states are not accepted-only", () => {
    const entry = buildScorecardLayerEntry(
      "mentions",
      reportWithDenominators("mentions", { evaluablePositives: 2, matchedPositives: 2 }),
      2,
      true,
    );

    expect(entry.gate.status).toBe("provisional");
  });

  it("skips layers with no eval cases", () => {
    const gate = resolveLayerGate("components", emptyReport().scores, 0, false);
    expect(gate.computability.summary).toBe("empty");
    expect(gate.gate.status).toBe("skip");
  });

  it("builds a corpus vector without cross-layer scalar fields", () => {
    const vector = buildScorecardVector({
      scannerGitSha: "abc123",
      generatedAt: "2026-08-31T00:00:00.000Z",
      reviewStates: ["accepted"],
      packets: [
        {
          repoKey: "packet-a",
          evalCases: [
            positiveCase("mentions", "m1"),
            positiveCase("data-flows", "f1"),
          ],
          layerScores: {
            mentions: reportWithDenominators("mentions", {
              evaluablePositives: 1,
              matchedPositives: 1,
            }),
            "data-flows": reportWithDenominators(
              "data-flows",
              {
                evaluablePositives: 0,
                exhaustiveScopedFindings: 2,
                exhaustiveScopedMatches: 0,
              },
              { precision: 0 },
              {
                positiveCaseCount: 1,
                reviewedScopeFileCount: 1,
                processedScopeFileCount: 1,
              },
            ),
          },
        },
        {
          repoKey: "packet-b",
          evalCases: [positiveCase("mentions", "m2")],
          layerScores: {
            mentions: reportWithDenominators("mentions", {
              evaluablePositives: 1,
              matchedPositives: 0,
            }),
          },
        },
      ],
    });

    expect(vector.contractVersion).toBe(SCORECARD_VECTOR_CONTRACT_VERSION);
    expect(vector.layers.mentions.scores.recall).toBe(0.5);
    expect(vector.layers["data-flows"].gate.status).toBe("pending");
    expect(vector.layers["data-flows"].scores.recall).toBeNull();
    expect(vector.layers["data-flows"].computability.metrics.precision.state).toBe("computable");
    expect(vector.packets).toHaveLength(2);
    assertNoCrossLayerScalar(vector);
  });
});
