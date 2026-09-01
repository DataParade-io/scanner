import type {
  EvalCase,
  EvalLayer,
  EvalScoreDenominators,
  EvalScoreReport,
  EvalScores,
  HeadlineMetricKind,
  MetricComputability,
  MetricScore,
  FixtureScanResult,
} from "../eval/types";
import {
  aggregateScopeDenominators,
  computeMetricComputability,
  emptyMetricComputability,
  rollupLayerComputabilitySummary,
  type LayerComputabilitySummary,
} from "../../src/eval/canonical/computability";
import type { ReviewState } from "./schema";
import {
  DIAGNOSTIC_LAYERS,
  HEADLINE_LAYERS,
  scoreEvalCasesByLayer,
  type HeadlineLayer,
} from "../eval/score";
import {
  aggregateLayerReportAccounting,
  buildLayerReportAccounting,
  type LayerReportAccounting,
  type PacketCanonicalRecordWithDiagnostics,
} from "./layer-report-accounting";

export type { LayerReportAccounting } from "./layer-report-accounting";

export { HEADLINE_LAYERS, DIAGNOSTIC_LAYERS, type HeadlineLayer };

export const SCORECARD_VECTOR_CONTRACT_VERSION = "scorecard-vector/2";

export type LayerGateStatus = "scorable" | "pending" | "skip" | "provisional";

export type UnscorableReason = "needs_adjudication";

export interface LayerGateResult {
  status: LayerGateStatus;
  reason?: string;
}

export interface LayerComputabilityBlock {
  summary: LayerComputabilitySummary;
  metrics: Record<HeadlineMetricKind, MetricScore>;
  scope: MetricComputability["scope"];
  locationlessFindingCount: number;
  unscorableReason?: UnscorableReason;
}

export interface ScorecardLayerEntry {
  layer: HeadlineLayer;
  computability: LayerComputabilityBlock;
  scores: EvalScores;
  gate: LayerGateResult;
  accounting: LayerReportAccounting;
}

export interface ScorecardDiagnostic {
  "raw-hits": EvalScoreReport;
}

export interface ScorecardPacketRow {
  repoKey: string;
  layers: Record<HeadlineLayer, ScorecardLayerEntry>;
  diagnostic: ScorecardDiagnostic;
}

export interface ScorecardVector {
  contractVersion: typeof SCORECARD_VECTOR_CONTRACT_VERSION;
  scannerGitSha: string;
  generatedAt: string;
  reviewStates: ReviewState[];
  layers: Record<HeadlineLayer, ScorecardLayerEntry>;
  diagnostic: ScorecardDiagnostic;
  packets: ScorecardPacketRow[];
}

export interface BuildScorecardVectorInput {
  scannerGitSha: string;
  generatedAt: string;
  reviewStates: ReviewState[];
  packets: Array<{
    repoKey: string;
    evalCases: EvalCase[];
    layerScores: Partial<Record<EvalLayer, EvalScoreReport>>;
    scanResult?: FixtureScanResult;
    canonicalRecords?: PacketCanonicalRecordWithDiagnostics[];
  }>;
}

function isProvisionalReviewStates(reviewStates: ReviewState[]): boolean {
  return !reviewStates.every((state) => state === "accepted");
}

function caseCountForLayer(evalCases: EvalCase[], layer: HeadlineLayer): number {
  return evalCases.filter((caseRecord) => caseRecord.layer === layer).length;
}

function layerCases(evalCases: EvalCase[], layer: HeadlineLayer): EvalCase[] {
  return evalCases.filter((caseRecord) => caseRecord.layer === layer);
}

function unreadCountsFromCaseResults(
  cases: EvalCase[],
  caseResults: EvalCaseResult[],
): { unreadPositiveCount: number; unreadNegativeCount: number } {
  const unreadByCaseId = new Map(caseResults.map((result) => [result.caseId, result.unread]));
  let unreadPositiveCount = 0;
  let unreadNegativeCount = 0;

  for (const caseRecord of cases) {
    if (!unreadByCaseId.get(caseRecord.id)) {
      continue;
    }
    if (caseRecord.expected.status === "positive") {
      unreadPositiveCount += 1;
    } else if (caseRecord.expected.status === "negative") {
      unreadNegativeCount += 1;
    }
  }

  return { unreadPositiveCount, unreadNegativeCount };
}

type EvalCaseResult = EvalScoreReport["caseResults"][number];

function hasEvaluableWork(scores: EvalScores): boolean {
  const { denominators, metricComputability } = scores;
  const recallComputable = metricComputability.metrics.recall.state === "computable";
  const precisionComputable = metricComputability.metrics.precision.state === "computable";
  const negativeComputable =
    metricComputability.metrics.negativeCasePassRate.state === "computable";
  return (
    recallComputable ||
    precisionComputable ||
    negativeComputable ||
    denominators.evaluablePositives > 0 ||
    denominators.negativeCases > 0 ||
    denominators.exhaustiveScopedFindings > 0
  );
}

function buildComputabilityBlock(
  layer: HeadlineLayer,
  metricComputability: MetricComputability,
  caseCount: number,
  provisional: boolean,
): LayerComputabilityBlock {
  const summary = rollupLayerComputabilitySummary(
    layer,
    caseCount,
    metricComputability.metrics,
    provisional,
  );
  return {
    summary,
    metrics: metricComputability.metrics,
    scope: metricComputability.scope,
    locationlessFindingCount: metricComputability.locationlessFindingCount,
    unscorableReason:
      layer === "data-flows" && caseCount > 0 ? "needs_adjudication" : undefined,
  };
}

export function resolveLayerGate(
  layer: HeadlineLayer,
  scores: EvalScores,
  caseCount: number,
  provisional: boolean,
): { computability: LayerComputabilityBlock; gate: LayerGateResult } {
  const computability = buildComputabilityBlock(
    layer,
    scores.metricComputability,
    caseCount,
    provisional,
  );

  if (provisional) {
    return {
      computability,
      gate: {
        status: "provisional",
        reason: "non_accepted_review_states",
      },
    };
  }

  if (caseCount === 0) {
    return {
      computability,
      gate: { status: "skip", reason: "no_eval_cases" },
    };
  }

  if (layer === "data-flows") {
    return {
      computability,
      gate: {
        status: "pending",
        reason: "awaiting_canonical_flow_adjudication",
      },
    };
  }

  if (!hasEvaluableWork(scores)) {
    return {
      computability,
      gate: { status: "skip", reason: "no_evaluable_work" },
    };
  }

  return {
    computability,
    gate: { status: "scorable" },
  };
}

export function buildScorecardLayerEntry(
  layer: HeadlineLayer,
  report: EvalScoreReport,
  caseCount: number,
  provisional: boolean,
  accountingInput?: {
    cases: EvalCase[];
    scanResult?: FixtureScanResult;
    canonicalRecords: PacketCanonicalRecordWithDiagnostics[];
  },
): ScorecardLayerEntry {
  const resolved = resolveLayerGate(layer, report.scores, caseCount, provisional);
  const accounting =
    accountingInput === undefined
      ? aggregateLayerReportAccounting([])
      : buildLayerReportAccounting({
          layer,
          report,
          cases: accountingInput.cases,
          scanResult: accountingInput.scanResult,
          canonicalRecords: accountingInput.canonicalRecords,
          gate: resolved.gate,
          computability: resolved.computability,
        });
  return {
    layer,
    computability: resolved.computability,
    scores: report.scores,
    gate: resolved.gate,
    accounting,
  };
}

function emptyScores(): EvalScores {
  return {
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
    metricComputability: emptyMetricComputability(),
  };
}

function rateOrNull(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function aggregateLayerScores(
  reports: EvalScoreReport[],
  layer: HeadlineLayer,
  evalCases: EvalCase[],
): EvalScores {
  const denominators: EvalScoreDenominators = {
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
    const { denominators: packetDenominators } = report.scores;
    denominators.evaluablePositives += packetDenominators.evaluablePositives;
    denominators.matchedPositives += packetDenominators.matchedPositives;
    denominators.matchedWithCorrectLabels += packetDenominators.matchedWithCorrectLabels;
    denominators.matchedAncestorCategory += packetDenominators.matchedAncestorCategory;
    denominators.negativeCases += packetDenominators.negativeCases;
    denominators.negativeCasesPassed += packetDenominators.negativeCasesPassed;
    denominators.exhaustiveScopedFindings += packetDenominators.exhaustiveScopedFindings;
    denominators.exhaustiveScopedMatches += packetDenominators.exhaustiveScopedMatches;
    unreadCount += report.scores.unreadCount;
  }

  const recall = rateOrNull(denominators.matchedPositives, denominators.evaluablePositives);
  const ancestorCategoryRecall = rateOrNull(
    denominators.matchedAncestorCategory,
    denominators.evaluablePositives,
  );
  const labelAccuracy = rateOrNull(
    denominators.matchedWithCorrectLabels,
    denominators.matchedPositives,
  );
  const correctLabelRecall = rateOrNull(
    denominators.matchedWithCorrectLabels,
    denominators.evaluablePositives,
  );
  const precision = rateOrNull(
    denominators.exhaustiveScopedMatches,
    denominators.exhaustiveScopedFindings,
  );
  const negativeCasePassRate = rateOrNull(
    denominators.negativeCasesPassed,
    denominators.negativeCases,
  );

  const cases = layerCases(evalCases, layer);
  const caseResults = reports.flatMap((report) => report.caseResults);
  const { unreadPositiveCount, unreadNegativeCount } = unreadCountsFromCaseResults(
    cases,
    caseResults,
  );
  const scope = aggregateScopeDenominators(
    reports.map((report) => report.scores.metricComputability.scope),
  );
  const locationlessFindingCount = reports.reduce(
    (sum, report) => sum + report.scores.metricComputability.locationlessFindingCount,
    0,
  );

  const metricComputability = computeMetricComputability({
    layer,
    denominators,
    scope,
    recall,
    precision,
    negativeCasePassRate,
    positiveCaseCount: cases.filter((caseRecord) => caseRecord.expected.status === "positive")
      .length,
    unreadPositiveCount,
    negativeCaseCount: cases.filter((caseRecord) => caseRecord.expected.status === "negative")
      .length,
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

export function aggregateEvalScores(reports: EvalScoreReport[]): EvalScores {
  if (reports.length === 0) {
    return emptyScores();
  }
  return aggregateLayerScores(reports, "mentions", []);
}

function buildPacketLayers(
  evalCases: EvalCase[],
  layerScores: Partial<Record<EvalLayer, EvalScoreReport>>,
  provisional: boolean,
  scanResult?: FixtureScanResult,
  canonicalRecords: PacketCanonicalRecordWithDiagnostics[] = [],
): Record<HeadlineLayer, ScorecardLayerEntry> {
  const layers = {} as Record<HeadlineLayer, ScorecardLayerEntry>;
  for (const layer of HEADLINE_LAYERS) {
    const caseCount = caseCountForLayer(evalCases, layer);
    const report = layerScores[layer] ?? { scores: emptyScores(), caseResults: [] };
    layers[layer] = buildScorecardLayerEntry(layer, report, caseCount, provisional, {
      cases: evalCases,
      scanResult,
      canonicalRecords,
    });
  }
  return layers;
}

function aggregateDiagnostic(
  diagnostics: ScorecardDiagnostic[],
): ScorecardDiagnostic {
  const reports = diagnostics.map((entry) => entry["raw-hits"]);
  return {
    "raw-hits": {
      scores: aggregateEvalScores(reports),
      caseResults: reports.flatMap((report) => report.caseResults),
    },
  };
}

export function buildScorecardVector(input: BuildScorecardVectorInput): ScorecardVector {
  const provisional = isProvisionalReviewStates(input.reviewStates);
  const packetRows: ScorecardPacketRow[] = input.packets.map((packet) => {
    const diagnosticReport = packet.layerScores["raw-hits"] ?? {
      scores: emptyScores(),
      caseResults: [],
    };
    return {
      repoKey: packet.repoKey,
      layers: buildPacketLayers(
        packet.evalCases,
        packet.layerScores,
        provisional,
        packet.scanResult,
        packet.canonicalRecords ?? [],
      ),
      diagnostic: { "raw-hits": diagnosticReport },
    };
  });

  const layers = {} as Record<HeadlineLayer, ScorecardLayerEntry>;
  const allEvalCases = input.packets.flatMap((packet) => packet.evalCases);
  for (const layer of HEADLINE_LAYERS) {
    const packetReports = input.packets
      .map((packet) => packet.layerScores[layer])
      .filter((report): report is EvalScoreReport => report !== undefined);
    const aggregatedScores = aggregateLayerScores(packetReports, layer, allEvalCases);
    const totalCaseCount = input.packets.reduce(
      (sum, packet) => sum + caseCountForLayer(packet.evalCases, layer),
      0,
    );
    const layerEntry = buildScorecardLayerEntry(
      layer,
      { scores: aggregatedScores, caseResults: [] },
      totalCaseCount,
      provisional,
    );
    const packetAccountings = packetRows.map((packet) => packet.layers[layer].accounting);
    layers[layer] = {
      ...layerEntry,
      accounting: aggregateLayerReportAccounting(packetAccountings),
    };
  }

  return {
    contractVersion: SCORECARD_VECTOR_CONTRACT_VERSION,
    scannerGitSha: input.scannerGitSha,
    generatedAt: input.generatedAt,
    reviewStates: input.reviewStates,
    layers,
    diagnostic: aggregateDiagnostic(packetRows.map((packet) => packet.diagnostic)),
    packets: packetRows,
  };
}

export function scoreLayersForScorecard(
  evalCases: EvalCase[],
  scanResults: Parameters<typeof scoreEvalCasesByLayer>[1],
): {
  layerScores: Partial<Record<EvalLayer, EvalScoreReport>>;
  headlineLayerScores: Partial<Record<HeadlineLayer, EvalScoreReport>>;
  diagnosticRawHits?: EvalScoreReport;
} {
  const layerScores = scoreEvalCasesByLayer(evalCases, scanResults);
  const headlineLayerScores: Partial<Record<HeadlineLayer, EvalScoreReport>> = {};
  for (const layer of HEADLINE_LAYERS) {
    if (layerScores[layer]) {
      headlineLayerScores[layer] = layerScores[layer];
    }
  }
  return {
    layerScores,
    headlineLayerScores,
    diagnosticRawHits: layerScores[DIAGNOSTIC_LAYERS[0]],
  };
}

export function formatRate(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function formatMetricScore(metric: MetricScore): string {
  return `${formatRate(metric.value)} [${metric.state}; ${metric.numerator}/${metric.denominator}]`;
}

export function formatScorecardVectorMarkdown(vector: ScorecardVector): string {
  const lines: string[] = [
    "# Scanner scorecard vector",
    "",
    `Contract: ${vector.contractVersion}`,
    `Generated: ${vector.generatedAt}`,
    `Scanner: ${vector.scannerGitSha}`,
    `Review states: ${vector.reviewStates.join(", ")}`,
    `Packets: ${vector.packets.length}`,
    "",
    "## Headline layers (no cross-layer scalar)",
    "",
  ];

  for (const layer of HEADLINE_LAYERS) {
    const entry = vector.layers[layer];
    lines.push(`### ${layer}`);
    lines.push(`- Summary: ${entry.computability.summary}`);
    if (entry.computability.unscorableReason) {
      lines.push(`- Unscorable reason: ${entry.computability.unscorableReason}`);
    }
    lines.push(`- Gate: ${entry.gate.status}${entry.gate.reason ? ` (${entry.gate.reason})` : ""}`);
    lines.push(`- Recall: ${formatMetricScore(entry.computability.metrics.recall)}`);
    lines.push(
      `- Ancestor recall: ${formatMetricScore(entry.computability.metrics.ancestorCategoryRecall)}`,
    );
    lines.push(`- Precision: ${formatMetricScore(entry.computability.metrics.precision)}`);
    lines.push(
      `- Negative pass rate: ${formatMetricScore(entry.computability.metrics.negativeCasePassRate)}`,
    );
    lines.push(
      `- Scope: reviewedFiles=${entry.computability.scope.reviewedScopeFileCount}, processedFiles=${entry.computability.scope.processedScopeFileCount}, locationlessFindings=${entry.computability.locationlessFindingCount}`,
    );
    lines.push(
      `- Denominators: evaluablePositives=${entry.scores.denominators.evaluablePositives}, exhaustiveScopedFindings=${entry.scores.denominators.exhaustiveScopedFindings}`,
    );
    lines.push(
      `- Population: acceptedCanonical=${entry.accounting.population.acceptedCanonicalPositives}, evaluable=${entry.accounting.population.evaluablePositives}, matched=${entry.accounting.population.matchedPositives}`,
    );
    lines.push(
      `- Coverage: entityWeighted=${entry.accounting.coverage.entityWeighted.numerator}/${entry.accounting.coverage.entityWeighted.denominator}, distinctFiles=${entry.accounting.coverage.distinctEvidenceFiles.numerator}/${entry.accounting.coverage.distinctEvidenceFiles.denominator}`,
    );
    if (entry.accounting.migrationIncomplete.total > 0) {
      lines.push(`- Migration incomplete: ${entry.accounting.migrationIncomplete.total}`);
    }
    lines.push("");
  }

  for (const packet of vector.packets) {
    lines.push(`## Packet: ${packet.repoKey}`, "");
    for (const layer of HEADLINE_LAYERS) {
      const entry = packet.layers[layer];
      lines.push(`### ${layer}`);
      lines.push(
        `- acceptedCanonical=${entry.accounting.population.acceptedCanonicalPositives}, evaluable=${entry.accounting.population.evaluablePositives}, matched=${entry.accounting.population.matchedPositives}`,
      );
      lines.push(`- unread: ${entry.accounting.population.unreadCount} (${formatRate(entry.accounting.population.unreadRate)})`);
      lines.push(
        `- capability (diagnostic): ${(entry.accounting.slices.capability.caseWeighted * 100).toFixed(1)}% case-weighted`,
      );
      lines.push("");
    }
  }

  const rawHits = vector.diagnostic["raw-hits"].scores;
  lines.push("## Diagnostic: raw-hits (not in headline vector)");
  lines.push(`- Recall: ${formatRate(rawHits.recall)}`);
  lines.push(`- Precision: ${formatRate(rawHits.precision)}`);
  lines.push(
    `- Denominators: evaluablePositives=${rawHits.denominators.evaluablePositives}`,
  );

  return `${lines.join("\n")}\n`;
}

export function assertNoCrossLayerScalar(value: unknown): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  const forbidden = ["overall", "crossLayer", "crossLayerScalar", "aggregateScore", "totalScore"];
  for (const key of forbidden) {
    if (key in (value as Record<string, unknown>)) {
      throw new Error(`Scorecard vector must not include cross-layer scalar field '${key}'`);
    }
  }
}
