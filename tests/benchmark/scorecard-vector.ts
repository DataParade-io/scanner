import type {
  EvalCase,
  EvalLayer,
  EvalScoreDenominators,
  EvalScoreReport,
  EvalScores,
} from "../eval/types";
import type { ReviewState } from "./schema";
import {
  DIAGNOSTIC_LAYERS,
  HEADLINE_LAYERS,
  scoreEvalCasesByLayer,
  type HeadlineLayer,
} from "../eval/score";

export { HEADLINE_LAYERS, DIAGNOSTIC_LAYERS, type HeadlineLayer };

export const SCORECARD_VECTOR_CONTRACT_VERSION = "scorecard-vector/1";

export type LayerComputability = "scorable" | "unscorable" | "empty";

export type LayerGateStatus = "scorable" | "pending" | "skip" | "provisional";

export type UnscorableReason = "needs_adjudication";

export interface LayerGateResult {
  status: LayerGateStatus;
  reason?: string;
}

export interface ScorecardLayerEntry {
  layer: HeadlineLayer;
  computability: LayerComputability;
  unscorableReason?: UnscorableReason;
  scores: EvalScores;
  gate: LayerGateResult;
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
  }>;
}

function isProvisionalReviewStates(reviewStates: ReviewState[]): boolean {
  return !reviewStates.every((state) => state === "accepted");
}

function caseCountForLayer(evalCases: EvalCase[], layer: HeadlineLayer): number {
  return evalCases.filter((caseRecord) => caseRecord.layer === layer).length;
}

function hasEvaluableWork(scores: EvalScores): boolean {
  const { denominators } = scores;
  return (
    denominators.evaluablePositives > 0 ||
    denominators.negativeCases > 0 ||
    denominators.exhaustiveScopedFindings > 0
  );
}

export function resolveLayerGate(
  layer: HeadlineLayer,
  scores: EvalScores,
  caseCount: number,
  provisional: boolean,
): { computability: LayerComputability; unscorableReason?: UnscorableReason; gate: LayerGateResult } {
  if (provisional) {
    return {
      computability: caseCount === 0 ? "empty" : layer === "data-flows" ? "unscorable" : "scorable",
      unscorableReason: layer === "data-flows" && caseCount > 0 ? "needs_adjudication" : undefined,
      gate: {
        status: "provisional",
        reason: "non_accepted_review_states",
      },
    };
  }

  if (caseCount === 0) {
    return {
      computability: "empty",
      gate: { status: "skip", reason: "no_eval_cases" },
    };
  }

  if (layer === "data-flows") {
    return {
      computability: "unscorable",
      unscorableReason: "needs_adjudication",
      gate: {
        status: "pending",
        reason: "awaiting_canonical_flow_adjudication",
      },
    };
  }

  if (!hasEvaluableWork(scores)) {
    return {
      computability: "empty",
      gate: { status: "skip", reason: "no_evaluable_work" },
    };
  }

  return {
    computability: "scorable",
    gate: { status: "scorable" },
  };
}

export function buildScorecardLayerEntry(
  layer: HeadlineLayer,
  report: EvalScoreReport,
  caseCount: number,
  provisional: boolean,
): ScorecardLayerEntry {
  const resolved = resolveLayerGate(layer, report.scores, caseCount, provisional);
  return {
    layer,
    computability: resolved.computability,
    unscorableReason: resolved.unscorableReason,
    scores: report.scores,
    gate: resolved.gate,
  };
}

function emptyScores(): EvalScores {
  return {
    recall: null,
    labelAccuracy: null,
    correctLabelRecall: null,
    precision: null,
    negativeCasePassRate: null,
    unreadCount: 0,
    denominators: {
      evaluablePositives: 0,
      matchedPositives: 0,
      matchedWithCorrectLabels: 0,
      negativeCases: 0,
      negativeCasesPassed: 0,
      exhaustiveScopedFindings: 0,
      exhaustiveScopedMatches: 0,
    },
  };
}

function rateOrNull(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function aggregateEvalScores(reports: EvalScoreReport[]): EvalScores {
  const denominators: EvalScoreDenominators = {
    evaluablePositives: 0,
    matchedPositives: 0,
    matchedWithCorrectLabels: 0,
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
    denominators.negativeCases += packetDenominators.negativeCases;
    denominators.negativeCasesPassed += packetDenominators.negativeCasesPassed;
    denominators.exhaustiveScopedFindings += packetDenominators.exhaustiveScopedFindings;
    denominators.exhaustiveScopedMatches += packetDenominators.exhaustiveScopedMatches;
    unreadCount += report.scores.unreadCount;
  }

  return {
    recall: rateOrNull(denominators.matchedPositives, denominators.evaluablePositives),
    labelAccuracy: rateOrNull(
      denominators.matchedWithCorrectLabels,
      denominators.matchedPositives,
    ),
    correctLabelRecall: rateOrNull(
      denominators.matchedWithCorrectLabels,
      denominators.evaluablePositives,
    ),
    precision: rateOrNull(
      denominators.exhaustiveScopedMatches,
      denominators.exhaustiveScopedFindings,
    ),
    negativeCasePassRate: rateOrNull(
      denominators.negativeCasesPassed,
      denominators.negativeCases,
    ),
    unreadCount,
    denominators,
  };
}

function buildPacketLayers(
  evalCases: EvalCase[],
  layerScores: Partial<Record<EvalLayer, EvalScoreReport>>,
  provisional: boolean,
): Record<HeadlineLayer, ScorecardLayerEntry> {
  const layers = {} as Record<HeadlineLayer, ScorecardLayerEntry>;
  for (const layer of HEADLINE_LAYERS) {
    const caseCount = caseCountForLayer(evalCases, layer);
    const report = layerScores[layer] ?? { scores: emptyScores(), caseResults: [] };
    layers[layer] = buildScorecardLayerEntry(layer, report, caseCount, provisional);
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
      layers: buildPacketLayers(packet.evalCases, packet.layerScores, provisional),
      diagnostic: { "raw-hits": diagnosticReport },
    };
  });

  const layers = {} as Record<HeadlineLayer, ScorecardLayerEntry>;
  for (const layer of HEADLINE_LAYERS) {
    const packetEntries = packetRows.map((packet) => packet.layers[layer]);
    const aggregatedScores = aggregateEvalScores(
      packetEntries.map((entry) => ({ scores: entry.scores, caseResults: [] })),
    );
    const totalCaseCount = input.packets.reduce(
      (sum, packet) => sum + caseCountForLayer(packet.evalCases, layer),
      0,
    );
    layers[layer] = buildScorecardLayerEntry(
      layer,
      { scores: aggregatedScores, caseResults: [] },
      totalCaseCount,
      provisional,
    );
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

function formatRate(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
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
    lines.push(`- Computability: ${entry.computability}`);
    if (entry.unscorableReason) {
      lines.push(`- Unscorable reason: ${entry.unscorableReason}`);
    }
    lines.push(`- Gate: ${entry.gate.status}${entry.gate.reason ? ` (${entry.gate.reason})` : ""}`);
    lines.push(`- Recall: ${formatRate(entry.scores.recall)}`);
    lines.push(`- Precision: ${formatRate(entry.scores.precision)}`);
    lines.push(
      `- Denominators: evaluablePositives=${entry.scores.denominators.evaluablePositives}, exhaustiveScopedFindings=${entry.scores.denominators.exhaustiveScopedFindings}`,
    );
    lines.push("");
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
