import { assignOneToOne, type AssignmentResult } from "./canonical/assignment";
import { computeMetricComputability } from "./canonical/computability";
import { conceptCorrectness, negativeObservationCandidate } from "./canonical/match";
import type {
  CanonicalGoldExpectation,
  CanonicalLayer,
  CanonicalScannerFinding,
} from "./canonical/types";
import { isEvalPathContractValid, normalizeEvalPath } from "./path";
import type {
  ExpectationEvaluationMeta,
  LayerEvaluationInput,
  LayerEvaluationReport,
  ExpectationOutcome,
} from "./report-types";

const LAYER_GENERIC_LABELS: Record<CanonicalLayer, ReadonlySet<string>> = {
  components: new Set(["component"]),
  "data-flows": new Set(["data_flow", "dataflow"]),
  mentions: new Set(["pii", "pii_signal", "mention"]),
  "raw-hits": new Set(["pii", "pii_signal", "raw_hit"]),
  "data-items": new Set(["data_item", "dataitem"]),
};

function metaById(
  meta: ReadonlyArray<ExpectationEvaluationMeta>,
): Map<string, ExpectationEvaluationMeta> {
  return new Map(meta.map((entry) => [entry.id, entry]));
}

function labelsCorrectForPair(
  layer: CanonicalLayer,
  expectedLabels: readonly string[],
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  if (expectedLabels.length === 0) {
    return true;
  }

  if (expectedLabels.every((label) => LAYER_GENERIC_LABELS[layer].has(label))) {
    return true;
  }

  if (layer === "data-items") {
    return true;
  }

  return conceptCorrectness(expectation, finding).exactLeaf;
}

function findingMatchesNegative(
  canonical: CanonicalGoldExpectation,
  findings: ReadonlyArray<CanonicalScannerFinding & { id: string }>,
): CanonicalScannerFinding | undefined {
  return findings.find((finding) => negativeObservationCandidate(canonical, finding));
}

function findingHasLocations(finding: CanonicalScannerFinding): boolean {
  return finding.evidenceLocations.length > 0;
}

function findingInScope(
  finding: CanonicalScannerFinding,
  scopeFiles: readonly string[],
): boolean {
  if (scopeFiles.length === 0) {
    return false;
  }
  const normalizedScope = new Set(scopeFiles.map(normalizeEvalPath));
  return finding.evidenceLocations.some(
    (location) =>
      isEvalPathContractValid(location.file_path) &&
      normalizedScope.has(normalizeEvalPath(location.file_path)),
  );
}

function computePrecisionFromAssignment(
  findings: ReadonlyArray<CanonicalScannerFinding & { id: string }>,
  assignment: AssignmentResult,
  scopeFiles: readonly string[],
): { exhaustiveScopedFindings: number; exhaustiveScopedMatches: number } {
  if (scopeFiles.length === 0) {
    return { exhaustiveScopedFindings: 0, exhaustiveScopedMatches: 0 };
  }

  const matchedFindingIds = new Set(assignment.pairs.map((pair) => pair.findingId));
  let exhaustiveScopedFindings = 0;
  let exhaustiveScopedMatches = 0;

  for (const finding of findings) {
    if (!findingHasLocations(finding) || !findingInScope(finding, scopeFiles)) {
      continue;
    }
    exhaustiveScopedFindings += 1;
    if (matchedFindingIds.has(finding.id)) {
      exhaustiveScopedMatches += 1;
    }
  }

  return { exhaustiveScopedFindings, exhaustiveScopedMatches };
}

export function evaluateLayerBucket(input: LayerEvaluationInput): LayerEvaluationReport {
  const {
    layer,
    expectations,
    findings,
    expectationMeta,
    exhaustiveScopeFiles = [],
    eligibility,
  } = input;

  const metaMap = metaById(expectationMeta);
  const evaluableExpectations = expectations.filter((expectation) => {
    const meta = metaMap.get(expectation.id);
    return meta?.isRecallEvaluable && !meta.unread;
  });

  const assignment = assignOneToOne([...evaluableExpectations], [...findings]);
  const pairByExpectationId = new Map(
    assignment.pairs.map((pair) => [pair.expectationId, pair.findingId]),
  );
  const findingById = new Map(findings.map((finding) => [finding.id, finding]));

  const perExpectation: ExpectationOutcome[] = [];
  let evaluablePositives = 0;
  let matchedPositives = 0;
  let matchedWithCorrectLabels = 0;
  let matchedAncestorCategory = 0;
  let negativeCases = 0;
  let negativeCasesPassed = 0;
  let unreadCount = 0;
  let positiveCaseCount = 0;
  let unreadPositiveCount = 0;
  let negativeCaseCount = 0;
  let unreadNegativeCount = 0;

  for (const expectation of expectations) {
    const meta = metaMap.get(expectation.id);
    if (!meta) {
      throw new Error(`Missing evaluation metadata for expectation '${expectation.id}'`);
    }

    if (meta.unread) {
      unreadCount += 1;
    }

    const matchedFindingId = pairByExpectationId.get(expectation.id);
    const matchedFinding =
      matchedFindingId !== undefined ? findingById.get(matchedFindingId) : undefined;
    const matched = matchedFinding !== undefined;
    const labelsCorrect =
      matched &&
      labelsCorrectForPair(layer, meta.expectedLabels, expectation, matchedFinding!);

    let negativeClean = true;
    if (meta.isNegative) {
      negativeCaseCount += 1;
      if (meta.unread) {
        unreadNegativeCount += 1;
        negativeClean = false;
      } else {
        negativeCases += 1;
        const spuriousHit = findingMatchesNegative(expectation, findings);
        negativeClean = spuriousHit === undefined;
        if (negativeClean) {
          negativeCasesPassed += 1;
        }
      }
    }

    if (meta.isPositive) {
      positiveCaseCount += 1;
      if (meta.unread) {
        unreadPositiveCount += 1;
      }
    }

    if (meta.isRecallEvaluable && !meta.unread) {
      evaluablePositives += 1;
      if (matched) {
        matchedPositives += 1;
        if (labelsCorrect) {
          matchedWithCorrectLabels += 1;
        }
        if (matchedFinding && conceptCorrectness(expectation, matchedFinding).ancestorCategory) {
          matchedAncestorCategory += 1;
        }
      }
    }

    perExpectation.push({
      expectationId: expectation.id,
      unread: meta.unread,
      matched,
      labelsCorrect,
      negativeClean,
      documentedGap: meta.documentedGap,
    });
  }

  const recall =
    evaluablePositives === 0 ? null : matchedPositives / evaluablePositives;
  const ancestorCategoryRecall =
    evaluablePositives === 0 ? null : matchedAncestorCategory / evaluablePositives;
  const labelAccuracy =
    matchedPositives === 0 ? null : matchedWithCorrectLabels / matchedPositives;
  const correctLabelRecall =
    evaluablePositives === 0 ? null : matchedWithCorrectLabels / evaluablePositives;
  const negativeCasePassRate =
    negativeCases === 0 ? null : negativeCasesPassed / negativeCases;

  const normalizedScope = exhaustiveScopeFiles
    .filter(isEvalPathContractValid)
    .map(normalizeEvalPath);
  const bucketPrecision = computePrecisionFromAssignment(findings, assignment, normalizedScope);
  const precision =
    bucketPrecision.exhaustiveScopedFindings === 0
      ? null
      : bucketPrecision.exhaustiveScopedMatches / bucketPrecision.exhaustiveScopedFindings;

  const scope = {
    reviewedScopeFileCount: eligibility?.reviewedScopeFiles.length ?? normalizedScope.length,
    processedScopeFileCount: eligibility?.processedScopeFiles.length ?? 0,
  };
  const locationlessFindingCount = eligibility?.locationlessFindingCount ?? 0;

  const denominators = {
    evaluablePositives,
    matchedPositives,
    matchedWithCorrectLabels,
    matchedAncestorCategory,
    negativeCases,
    negativeCasesPassed,
    exhaustiveScopedFindings: bucketPrecision.exhaustiveScopedFindings,
    exhaustiveScopedMatches: bucketPrecision.exhaustiveScopedMatches,
  };

  const metricComputability = computeMetricComputability({
    layer,
    denominators,
    scope,
    recall,
    precision,
    negativeCasePassRate,
    positiveCaseCount,
    unreadPositiveCount,
    negativeCaseCount,
    unreadNegativeCount,
    locationlessFindingCount,
  });

  return {
    scores: {
      recall,
      ancestorCategoryRecall,
      labelAccuracy,
      correctLabelRecall,
      precision,
      negativeCasePassRate,
      unreadCount,
      denominators,
      metricComputability,
    },
    assignment,
    perExpectation,
  };
}
