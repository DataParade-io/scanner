import type { EvalCase, EvalLayer, FixtureScanResult } from "../types";
import { normalizeEvalPath } from "../identity";
import {
  isSuccessfullyProcessed,
  layerOutcome,
  type PathEligibilityOutcome,
} from "../../../src/ingest/eligibility";
import type { LayerEligibilityLedger } from "./types";

export function getLayerLedger(
  scan: FixtureScanResult | undefined,
  layer: EvalLayer,
): LayerEligibilityLedger | undefined {
  return scan?.eligibilityLedgers?.[layer];
}

export function outcomeForPath(
  ledger: LayerEligibilityLedger | undefined,
  filePath: string,
): PathEligibilityOutcome | undefined {
  if (!ledger) {
    return undefined;
  }
  const normalized = normalizeEvalPath(filePath);
  return ledger.outcomes.find(
    (outcome) => normalizeEvalPath(outcome.path) === normalized,
  );
}

export function eligibleProcessedPaths(
  ledger: LayerEligibilityLedger | undefined,
): string[] {
  if (!ledger) {
    return [];
  }
  return ledger.outcomes
    .filter((outcome) => outcome.stage === "layer" && isSuccessfullyProcessed(outcome))
    .map((outcome) => normalizeEvalPath(outcome.path))
    .sort();
}

export function isEvidenceReadable(caseRecord: EvalCase, scan?: FixtureScanResult): boolean {
  const evidencePath = normalizeEvalPath(caseRecord.evidence.file_path);
  const ledger = getLayerLedger(scan, caseRecord.layer);
  const outcome = outcomeForPath(ledger, evidencePath);
  if (outcome?.stage === "layer" && isSuccessfullyProcessed(outcome)) {
    return true;
  }
  return (caseRecord.exhaustiveScopeFiles ?? []).some(
    (filePath) => normalizeEvalPath(filePath) === evidencePath,
  );
}

export function isUnread(caseRecord: EvalCase, scan?: FixtureScanResult): boolean {
  return !isEvidenceReadable(caseRecord, scan);
}

export function missingPathLayerOutcome(path: string): PathEligibilityOutcome {
  return layerOutcome(path, "missing_or_path_contract_mismatch");
}
