import type {
  EvalCase,
  EvalCaseResult,
  EvalLayer,
  EvalScoreReport,
  FixtureScanResult,
} from "../types";
import { normalizeEvalPath } from "../identity";
import { isUnread as isCaseUnread } from "../eligibility/ledger-access";
import { assignOneToOne, type AssignmentResult } from "./assignment";
import {
  canonicalFindingFromLayerFinding,
  canonicalGoldFromEvalCase,
  findingsForEvalLayer,
} from "./bridge";
import { assignmentCandidate, conceptCorrectness, negativeObservationCandidate } from "./match";
import { isAcceptedEvaluablePositive } from "./types";
import type { CanonicalGoldExpectation, CanonicalScannerFinding } from "./types";

const LAYER_GENERIC_LABELS: Record<EvalLayer, ReadonlySet<string>> = {
  components: new Set(["component"]),
  "data-flows": new Set(["data_flow", "dataflow"]),
  mentions: new Set(["pii", "pii_signal", "mention"]),
  "raw-hits": new Set(["pii", "pii_signal", "raw_hit"]),
  "data-items": new Set(["data_item", "dataitem"]),
};

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

function labelsCorrectForPair(
  caseRecord: EvalCase,
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  const expectedLabels = caseRecord.expected.labels;
  if (expectedLabels.length === 0) {
    return true;
  }

  if (expectedLabels.every((label) => LAYER_GENERIC_LABELS[caseRecord.layer].has(label))) {
    return true;
  }

  if (caseRecord.layer === "data-items") {
    return true;
  }

  return conceptCorrectness(expectation, finding).exactLeaf;
}

function findingMatchesCaseRecord(
  caseRecord: EvalCase,
  canonical: CanonicalGoldExpectation,
  findings: Array<CanonicalScannerFinding & { id: string }>,
): CanonicalScannerFinding | undefined {
  return findings.find((finding) => negativeObservationCandidate(canonical, finding));
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
        ...caseRecord.exhaustiveScopeFiles.map(normalizeEvalPath),
      ]),
    ]);
  }
  return scopes;
}

function findingHasLocations(finding: CanonicalScannerFinding): boolean {
  return finding.evidenceLocations.length > 0;
}

function findingInScope(finding: CanonicalScannerFinding, scopeFiles: string[]): boolean {
  if (scopeFiles.length === 0) {
    return false;
  }
  const normalizedScope = new Set(scopeFiles.map(normalizeEvalPath));
  return finding.evidenceLocations.some((location) =>
    normalizedScope.has(normalizeEvalPath(location.file_path)),
  );
}

function computePrecisionFromAssignment(
  findings: Array<CanonicalScannerFinding & { id: string }>,
  assignment: AssignmentResult,
  scopeFiles: string[],
): { precision: number | null; exhaustiveScopedFindings: number; exhaustiveScopedMatches: number } {
  if (scopeFiles.length === 0) {
    return {
      precision: null,
      exhaustiveScopedFindings: 0,
      exhaustiveScopedMatches: 0,
    };
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

  return {
    precision:
      exhaustiveScopedFindings === 0
        ? null
        : exhaustiveScopedMatches / exhaustiveScopedFindings,
    exhaustiveScopedFindings,
    exhaustiveScopedMatches,
  };
}

interface BucketState {
  fixture: string;
  layer: EvalLayer;
  cases: EvalCase[];
  expectations: Array<CanonicalGoldExpectation & { id: string }>;
  findings: Array<CanonicalScannerFinding & { id: string }>;
  assignment: AssignmentResult;
  pairByExpectationId: Map<string, string>;
  findingById: Map<string, CanonicalScannerFinding & { id: string }>;
  expectationById: Map<string, CanonicalGoldExpectation & { id: string }>;
}

function buildBucketStates(
  cases: EvalCase[],
  scanResults: FixtureScanResult[],
): Map<string, BucketState> {
  const byFixture = new Map(scanResults.map((result) => [result.fixture, result]));
  const buckets = new Map<string, BucketState>();

  for (const caseRecord of cases) {
    const key = scopeBucketKey(caseRecord.fixture, caseRecord.layer);
    const existing = buckets.get(key);
    if (existing) {
      existing.cases.push(caseRecord);
      continue;
    }

    const scan = byFixture.get(caseRecord.fixture);
    const expectations: Array<CanonicalGoldExpectation & { id: string }> = [];
    const bucketCases: EvalCase[] = [caseRecord];

    buckets.set(key, {
      fixture: caseRecord.fixture,
      layer: caseRecord.layer,
      cases: bucketCases,
      expectations,
      findings: findingsForEvalLayer(scan?.findings ?? [], caseRecord.layer, key),
      assignment: {
        pairs: [],
        unmatchedExpectationIds: [],
        unmatchedFindingIds: [],
        ambiguous: false,
      },
      pairByExpectationId: new Map(),
      findingById: new Map(),
      expectationById: new Map(),
    });
  }

  for (const bucket of buckets.values()) {
    const evaluableExpectations: Array<CanonicalGoldExpectation & { id: string }> = [];
    const scan = byFixture.get(bucket.fixture);

    for (const caseRecord of bucket.cases) {
      const canonical = canonicalGoldFromEvalCase(caseRecord);
      bucket.expectationById.set(caseRecord.id, canonical);
      const unread = isCaseUnread(caseRecord, scan);
      if (isRecallEvaluable(caseRecord, canonical) && !unread) {
        evaluableExpectations.push(canonical);
      }
    }

    bucket.expectations = evaluableExpectations;
    bucket.assignment = assignOneToOne(evaluableExpectations, bucket.findings);
    bucket.pairByExpectationId = new Map(
      bucket.assignment.pairs.map((pair) => [pair.expectationId, pair.findingId]),
    );
    bucket.findingById = new Map(bucket.findings.map((finding) => [finding.id, finding]));
  }

  return buckets;
}

export function evaluateCanonical(
  cases: EvalCase[],
  scanResults: FixtureScanResult[],
): EvalScoreReport {
  const byFixture = new Map(scanResults.map((result) => [result.fixture, result]));
  const buckets = buildBucketStates(cases, scanResults);
  const exhaustiveScopes = collectExhaustiveScopeFiles(cases);

  const caseResults: EvalCaseResult[] = [];
  let evaluablePositives = 0;
  let matchedPositives = 0;
  let matchedWithCorrectLabels = 0;
  let negativeCases = 0;
  let negativeCasesPassed = 0;
  let unreadCount = 0;

  for (const caseRecord of cases) {
    const scan = byFixture.get(caseRecord.fixture);
    const unread = isCaseUnread(caseRecord, scan);
    if (unread) {
      unreadCount += 1;
    }

    const bucketKey = scopeBucketKey(caseRecord.fixture, caseRecord.layer);
    const bucket = buckets.get(bucketKey)!;
    const canonical = bucket.expectationById.get(caseRecord.id) ?? canonicalGoldFromEvalCase(caseRecord);
    bucket.expectationById.set(caseRecord.id, canonical);

    const matchedFindingId = bucket.pairByExpectationId.get(caseRecord.id);
    const matchedFinding =
      matchedFindingId !== undefined ? bucket.findingById.get(matchedFindingId) : undefined;
    const matched = matchedFinding !== undefined;
    const labelsCorrect =
      matched &&
      labelsCorrectForPair(caseRecord, canonical, matchedFinding!);
    const documentedGap = Boolean(caseRecord.expected.documentedGap);

    let negativeClean = true;
    if (isNegativeCase(caseRecord)) {
      if (unread) {
        negativeClean = false;
      } else {
        negativeCases += 1;
        const spuriousHit = findingMatchesCaseRecord(caseRecord, canonical, bucket.findings);
        negativeClean = spuriousHit === undefined;
        if (negativeClean) {
          negativeCasesPassed += 1;
        }
      }
    }

    if (isRecallEvaluable(caseRecord, canonical) && !unread) {
      evaluablePositives += 1;
      if (matched) {
        matchedPositives += 1;
        if (labelsCorrect) {
          matchedWithCorrectLabels += 1;
        }
      }
    }

    caseResults.push({
      caseId: caseRecord.id,
      fixture: caseRecord.fixture,
      unread,
      matched,
      labelsCorrect,
      negativeClean,
      documentedGap,
    });
  }

  const recall =
    evaluablePositives === 0 ? null : matchedPositives / evaluablePositives;
  const labelAccuracy =
    matchedPositives === 0 ? null : matchedWithCorrectLabels / matchedPositives;
  const correctLabelRecall =
    evaluablePositives === 0 ? null : matchedWithCorrectLabels / evaluablePositives;
  const negativeCasePassRate =
    negativeCases === 0 ? null : negativeCasesPassed / negativeCases;

  let exhaustiveScopedFindings = 0;
  let exhaustiveScopedMatches = 0;

  for (const [bucketKey, scopeFiles] of exhaustiveScopes) {
    const bucket = buckets.get(bucketKey);
    if (!bucket) {
      continue;
    }
    const bucketPrecision = computePrecisionFromAssignment(
      bucket.findings,
      bucket.assignment,
      scopeFiles,
    );
    exhaustiveScopedFindings += bucketPrecision.exhaustiveScopedFindings;
    exhaustiveScopedMatches += bucketPrecision.exhaustiveScopedMatches;
  }

  const precision =
    exhaustiveScopedFindings === 0
      ? null
      : exhaustiveScopedMatches / exhaustiveScopedFindings;

  return {
    scores: {
      recall,
      labelAccuracy,
      correctLabelRecall,
      precision,
      negativeCasePassRate,
      unreadCount,
      denominators: {
        evaluablePositives,
        matchedPositives,
        matchedWithCorrectLabels,
        negativeCases,
        negativeCasesPassed,
        exhaustiveScopedFindings,
        exhaustiveScopedMatches,
      },
    },
    caseResults,
  };
}
