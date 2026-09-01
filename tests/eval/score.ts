import type { EvalCase, EvalLayer, EvalScoreReport, FixtureScanResult } from "./types";
import { evaluateCanonical } from "./canonical/evaluate";

export function scoreEvalCases(
  cases: EvalCase[],
  scanResults: FixtureScanResult[],
): EvalScoreReport {
  return evaluateCanonical(cases, scanResults);
}

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
