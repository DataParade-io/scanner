import type {
  EvalCase,
  EvalCaseResult,
  EvalLayer,
  EvalScoreReport,
  FixtureScanResult,
} from "../types";
import { evaluateLayerBucket } from "../../../src/eval/evaluate";
import type {
  ExpectationEvaluationMeta,
  LayerEvaluationReport,
} from "../../../src/eval/report-types";
import { isEvalPathContractValid, normalizeEvalPath } from "../../../src/eval/path";
import {
  isUnread as isCaseUnread,
  countProcessedScopeFiles,
  getLayerLedger,
  isPathSuccessfullyProcessed,
} from "../eligibility/ledger-access";
import {
  canonicalGoldFromEvalCase,
  findingsForEvalLayer,
} from "./bridge";
import { computeMetricComputability } from "../../../src/eval/canonical/computability";
import { isAcceptedEvaluablePositive } from "../../../src/eval/canonical/types";
import type { CanonicalGoldExpectation } from "../../../src/eval/canonical/types";
import type { EvalConceptScope, LayerFinding, ScopeDenominators } from "../types";
import {
  computeOccurrenceAttributeMetrics,
  computePairwiseGrouping,
  declaredOccurrenceAttributes,
  type GroupedOccurrence,
  type MatchedOccurrencePair,
} from "../../../src/eval/canonical/occurrence-attribute-metrics";

function scopeBucketKey(fixture: string, layer: EvalLayer): string {
  return `${fixture}::${layer}`;
}

function isNegativeCase(caseRecord: EvalCase): boolean {
  return caseRecord.expected.status === "negative";
}

function isRecallEvaluable(caseRecord: EvalCase, canonical: CanonicalGoldExpectation): boolean {
  return (
    caseRecord.expected.status === "positive" &&
    isAcceptedEvaluablePositive(canonical)
  );
}

/** Concept-scoped closed worlds per fixture and layer bucket (KDATAP-ec05ea). */
function collectConceptScopes(cases: EvalCase[]): Map<string, EvalConceptScope[]> {
  const scopes = new Map<string, Map<string, EvalConceptScope>>();
  for (const caseRecord of cases) {
    for (const scope of caseRecord.conceptScopes ?? []) {
      const key = scopeBucketKey(caseRecord.fixture, caseRecord.layer);
      const files = scope.files.filter(isEvalPathContractValid).map(normalizeEvalPath);
      const identity = JSON.stringify([[...scope.subjectKeys].sort(), [...files].sort()]);
      const bucket = scopes.get(key) ?? new Map<string, EvalConceptScope>();
      bucket.set(identity, { subjectKeys: [...scope.subjectKeys], files });
      scopes.set(key, bucket);
    }
  }
  return new Map([...scopes].map(([key, bucket]) => [key, [...bucket.values()]]));
}

/** Layer-wide and concept-scoped files together, for scope counts and eligibility. */
function unionScopeFiles(
  exhaustiveScopes: Map<string, string[]>,
  conceptScopes: Map<string, EvalConceptScope[]>,
): Map<string, string[]> {
  const union = new Map<string, string[]>();
  for (const key of new Set([...exhaustiveScopes.keys(), ...conceptScopes.keys()])) {
    union.set(key, [
      ...new Set([
        ...(exhaustiveScopes.get(key) ?? []),
        ...(conceptScopes.get(key) ?? []).flatMap((scope) => scope.files),
      ]),
    ]);
  }
  return union;
}

function collectExhaustiveScopeFiles(cases: EvalCase[]): Map<string, string[]> {
  const scopes = new Map<string, string[]>();
  for (const caseRecord of cases) {
    if (!caseRecord.exhaustiveScopeFiles || caseRecord.exhaustiveScopeFiles.length === 0) {
      continue;
    }
    const key = scopeBucketKey(caseRecord.fixture, caseRecord.layer);
    const existing = scopes.get(key) ?? [];
    scopes.set(key, [
      ...new Set([
        ...existing,
        ...caseRecord.exhaustiveScopeFiles
          .filter(isEvalPathContractValid)
          .map(normalizeEvalPath),
      ]),
    ]);
  }
  return scopes;
}

interface BucketState {
  fixture: string;
  layer: EvalLayer;
  cases: EvalCase[];
}

function buildBuckets(cases: EvalCase[], scanResults: FixtureScanResult[]): Map<string, BucketState> {
  const byFixture = new Map(scanResults.map((result) => [result.fixture, result]));
  const buckets = new Map<string, BucketState>();

  for (const caseRecord of cases) {
    const key = scopeBucketKey(caseRecord.fixture, caseRecord.layer);
    const existing = buckets.get(key);
    if (existing) {
      existing.cases.push(caseRecord);
      continue;
    }
    buckets.set(key, {
      fixture: caseRecord.fixture,
      layer: caseRecord.layer,
      cases: [caseRecord],
    });
    void byFixture;
  }

  return buckets;
}

function collectScopeMetrics(
  exhaustiveScopes: Map<string, string[]>,
  buckets: Map<string, BucketState>,
  byFixture: Map<string, FixtureScanResult>,
): { scope: ScopeDenominators; locationlessFindingCount: number } {
  const reviewedFiles = new Set<string>();
  const processedFiles = new Set<string>();
  let locationlessFindingCount = 0;

  for (const [bucketKey, scopeFiles] of exhaustiveScopes) {
    const bucket = buckets.get(bucketKey);
    if (!bucket) {
      continue;
    }
    const scan = byFixture.get(bucket.fixture);
    const ledger = getLayerLedger(scan, bucket.layer);
    const hasProcessedScope = countProcessedScopeFiles(scopeFiles, ledger) > 0;
    const findings = findingsForEvalLayer(scan?.findings ?? [], bucket.layer, bucketKey);

    for (const filePath of scopeFiles) {
      reviewedFiles.add(normalizeEvalPath(filePath));
      if (isPathSuccessfullyProcessed(ledger, filePath)) {
        processedFiles.add(normalizeEvalPath(filePath));
      }
    }

    if (hasProcessedScope) {
      for (const finding of findings) {
        if (finding.evidenceLocations.length === 0) {
          locationlessFindingCount += 1;
        }
      }
    }
  }

  return {
    scope: {
      reviewedScopeFileCount: reviewedFiles.size,
      processedScopeFileCount: processedFiles.size,
    },
    locationlessFindingCount,
  };
}

function mergeBucketReports(
  reports: LayerEvaluationReport[],
  layer: EvalLayer,
  scope: ScopeDenominators,
  locationlessFindingCount: number,
  positiveCaseCount: number,
  unreadPositiveCount: number,
  negativeCaseCount: number,
  unreadNegativeCount: number,
): EvalScoreReport["scores"] {
  const denominators = {
    evaluablePositives: 0,
    matchedPositives: 0,
    matchedWithCorrectLabels: 0,
    matchedAncestorCategory: 0,
    negativeCases: 0,
    negativeCasesPassed: 0,
    exhaustiveScopedFindings: 0,
    exhaustiveScopedMatches: 0,
  };
  let unreadCount = 0;

  for (const report of reports) {
    unreadCount += report.scores.unreadCount;
    denominators.evaluablePositives += report.scores.denominators.evaluablePositives;
    denominators.matchedPositives += report.scores.denominators.matchedPositives;
    denominators.matchedWithCorrectLabels += report.scores.denominators.matchedWithCorrectLabels;
    denominators.matchedAncestorCategory += report.scores.denominators.matchedAncestorCategory;
    denominators.negativeCases += report.scores.denominators.negativeCases;
    denominators.negativeCasesPassed += report.scores.denominators.negativeCasesPassed;
    denominators.exhaustiveScopedFindings += report.scores.denominators.exhaustiveScopedFindings;
    denominators.exhaustiveScopedMatches += report.scores.denominators.exhaustiveScopedMatches;
  }

  const recall =
    denominators.evaluablePositives === 0
      ? null
      : denominators.matchedPositives / denominators.evaluablePositives;
  const ancestorCategoryRecall =
    denominators.evaluablePositives === 0
      ? null
      : denominators.matchedAncestorCategory / denominators.evaluablePositives;
  const labelAccuracy =
    denominators.matchedPositives === 0
      ? null
      : denominators.matchedWithCorrectLabels / denominators.matchedPositives;
  const correctLabelRecall =
    denominators.evaluablePositives === 0
      ? null
      : denominators.matchedWithCorrectLabels / denominators.evaluablePositives;
  const negativeCasePassRate =
    denominators.negativeCases === 0
      ? null
      : denominators.negativeCasesPassed / denominators.negativeCases;
  const precision =
    denominators.exhaustiveScopedFindings === 0
      ? null
      : denominators.exhaustiveScopedMatches / denominators.exhaustiveScopedFindings;

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
    recall,
    ancestorCategoryRecall,
    labelAccuracy,
    correctLabelRecall,
    precision,
    negativeCasePassRate,
    unreadCount,
    denominators,
    metricComputability,
  };
}

export function evaluateCanonical(
  cases: EvalCase[],
  scanResults: FixtureScanResult[],
): EvalScoreReport {
  const byFixture = new Map(scanResults.map((result) => [result.fixture, result]));
  const buckets = buildBuckets(cases, scanResults);
  const exhaustiveScopes = collectExhaustiveScopeFiles(cases);
  const conceptScopes = collectConceptScopes(cases);
  const allScopeFiles = unionScopeFiles(exhaustiveScopes, conceptScopes);
  const layer = cases[0]?.layer ?? "components";

  const bucketReports: LayerEvaluationReport[] = [];
  const outcomeByCaseId = new Map<string, LayerEvaluationReport["perExpectation"][number] & { fixture: string }>();

  const occurrencePairs: MatchedOccurrencePair[] = [];
  const groupedOccurrences: GroupedOccurrence[] = [];
  const occurrenceFindings: LayerFinding[] = [];

  let positiveCaseCount = 0;
  let unreadPositiveCount = 0;
  let negativeCaseCount = 0;
  let unreadNegativeCount = 0;

  for (const [bucketKey, bucket] of buckets) {
    const scan = byFixture.get(bucket.fixture);
    const expectations = bucket.cases.map((caseRecord) => canonicalGoldFromEvalCase(caseRecord));
    const expectationMeta: ExpectationEvaluationMeta[] = bucket.cases.map((caseRecord, index) => {
      const canonical = expectations[index];
      const unread = isCaseUnread(caseRecord, scan);
      if (caseRecord.expected.status === "positive") {
        positiveCaseCount += 1;
        if (unread) {
          unreadPositiveCount += 1;
        }
      }
      if (isNegativeCase(caseRecord)) {
        negativeCaseCount += 1;
        if (unread) {
          unreadNegativeCount += 1;
        }
      }
      return {
        id: caseRecord.id,
        unread,
        documentedGap: Boolean(caseRecord.expected.documentedGap),
        isNegative: isNegativeCase(caseRecord),
        isPositive: caseRecord.expected.status === "positive",
        isRecallEvaluable: isRecallEvaluable(caseRecord, canonical),
        expectedLabels: caseRecord.expected.labels,
      };
    });

    const scopeFiles = exhaustiveScopes.get(bucketKey) ?? [];
    const bucketConceptScopes = conceptScopes.get(bucketKey) ?? [];
    const eligibleScopeFiles = allScopeFiles.get(bucketKey) ?? [];
    const reviewedScopeFiles = eligibleScopeFiles.map(normalizeEvalPath);
    const ledger = getLayerLedger(scan, bucket.layer);
    const processedScopeFiles = reviewedScopeFiles.filter((filePath) =>
      isPathSuccessfullyProcessed(ledger, filePath),
    );
    const hasProcessedScope = countProcessedScopeFiles(eligibleScopeFiles, ledger) > 0;
    const findings = findingsForEvalLayer(scan?.findings ?? [], bucket.layer, bucketKey);
    let locationlessFindingCount = 0;
    if (hasProcessedScope) {
      for (const finding of findings) {
        if (finding.evidenceLocations.length === 0) {
          locationlessFindingCount += 1;
        }
      }
    }

    const report = evaluateLayerBucket({
      layer: bucket.layer,
      expectations,
      findings,
      expectationMeta,
      exhaustiveScopeFiles: scopeFiles,
      conceptScopes: bucketConceptScopes,
      eligibility: {
        reviewedScopeFiles,
        processedScopeFiles,
        locationlessFindingCount,
      },
    });
    bucketReports.push(report);

    if (bucket.layer === "occurrences") {
      const layerFindings = (scan?.findings ?? []).filter(
        (finding) => finding.layer === undefined || finding.layer === bucket.layer,
      );
      occurrenceFindings.push(...layerFindings);
      const findingById = new Map(findings.map((finding, index) => [finding.id, layerFindings[index]]));
      const caseById = new Map(bucket.cases.map((caseRecord) => [caseRecord.id, caseRecord]));
      for (const pair of report.assignment.pairs) {
        const caseRecord = caseById.get(pair.expectationId);
        if (!caseRecord || caseRecord.expected.status !== "positive") {
          continue;
        }
        const finding = findingById.get(pair.findingId);
        occurrencePairs.push({ gold: caseRecord.occurrenceAttributes, finding: finding?.occurrenceAttributes });
        groupedOccurrences.push({
          goldGroup: caseRecord.occurrenceAttributes?.group,
          predictedGroup: finding?.occurrenceAttributes?.group,
        });
      }
    }

    for (const outcome of report.perExpectation) {
      outcomeByCaseId.set(outcome.expectationId, { ...outcome, fixture: bucket.fixture });
    }
  }

  const { scope, locationlessFindingCount } = collectScopeMetrics(
    allScopeFiles,
    buckets,
    byFixture,
  );

  const caseResults: EvalCaseResult[] = cases.map((caseRecord) => {
    const outcome = outcomeByCaseId.get(caseRecord.id);
    if (!outcome) {
      throw new Error(`Missing evaluation outcome for case '${caseRecord.id}'`);
    }
    return {
      caseId: caseRecord.id,
      fixture: outcome.fixture,
      unread: outcome.unread,
      matched: outcome.matched,
      labelsCorrect: outcome.labelsCorrect,
      negativeClean: outcome.negativeClean,
      documentedGap: outcome.documentedGap,
    };
  });

  const scores = mergeBucketReports(
    bucketReports,
    layer,
    scope,
    locationlessFindingCount,
    positiveCaseCount,
    unreadPositiveCount,
    negativeCaseCount,
    unreadNegativeCount,
  );
  if (layer === "occurrences") {
    const findingAttributes = occurrenceFindings.map((finding) => finding.occurrenceAttributes);
    scores.occurrenceAttributes = computeOccurrenceAttributeMetrics(
      occurrencePairs,
      declaredOccurrenceAttributes(findingAttributes),
    );
    scores.grouping = computePairwiseGrouping(
      groupedOccurrences,
      findingAttributes.some((attributes) => attributes?.group !== undefined),
    );
  }

  return { scores, caseResults };
}
