import type { EvalCase, EvalLayer, EvalScoreReport, FixtureScanResult } from "./types";
import { evaluateCanonical } from "./canonical/evaluate";

export function scoreEvalCases(
  cases: EvalCase[],
  scanResults: FixtureScanResult[],
): EvalScoreReport {
  return evaluateCanonical(cases, scanResults);
}

/** Headline scorecard layers — no cross-layer scalar is published across these. */
export const HEADLINE_LAYERS = [
  "mentions",
  "data-items",
  "components",
  "data-flows",
] as const;

export type HeadlineLayer = (typeof HEADLINE_LAYERS)[number];

/** Diagnostic-only layers — scanned and reported but excluded from headline vector gates. */
export const DIAGNOSTIC_LAYERS = ["raw-hits"] as const;

export type DiagnosticLayer = (typeof DIAGNOSTIC_LAYERS)[number];

const EVAL_LAYERS: EvalLayer[] = [
  "components",
  "data-flows",
  "raw-hits",
  "mentions",
  "data-items",
];

export function scoreEvalCasesByLayer(
  cases: EvalCase[],
  scanResults: FixtureScanResult[],
): Partial<Record<EvalLayer, EvalScoreReport>> {
  const reports: Partial<Record<EvalLayer, EvalScoreReport>> = {};
  for (const layer of EVAL_LAYERS) {
    const layerCases = cases.filter((caseRecord) => caseRecord.layer === layer);
    if (layerCases.length === 0) {
      continue;
    }
    reports[layer] = scoreEvalCases(layerCases, scanResults);
  }
  return reports;
}

export function scoreHeadlineLayersByLayer(
  cases: EvalCase[],
  scanResults: FixtureScanResult[],
): Partial<Record<HeadlineLayer, EvalScoreReport>> {
  const allLayers = scoreEvalCasesByLayer(cases, scanResults);
  const headline: Partial<Record<HeadlineLayer, EvalScoreReport>> = {};
  for (const layer of HEADLINE_LAYERS) {
    if (allLayers[layer]) {
      headline[layer] = allLayers[layer];
    }
  }
  return headline;
}
