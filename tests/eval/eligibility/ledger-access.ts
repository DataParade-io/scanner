import type { EvalCase, EvalLayer, FixtureScanResult } from "../types";
import { isEvalPathContractValid, normalizeEvalPath } from "../identity";
import {
  isSuccessfullyProcessed,
  layerOutcome,
  type EligibilityReason,
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
  if (!isEvalPathContractValid(filePath)) {
    return layerOutcome(filePath, "missing_or_path_contract_mismatch");
  }
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

export function isPathSuccessfullyProcessed(
  ledger: LayerEligibilityLedger | undefined,
  filePath: string,
): boolean {
  const outcome = outcomeForPath(ledger, filePath);
  return outcome?.stage === "layer" && isSuccessfullyProcessed(outcome);
}

export function countProcessedScopeFiles(
  scopeFiles: readonly string[],
  ledger: LayerEligibilityLedger | undefined,
): number {
  return scopeFiles.filter((filePath) => isPathSuccessfullyProcessed(ledger, filePath)).length;
}

export function evidenceEligibilityReason(
  caseRecord: EvalCase,
  scan?: FixtureScanResult,
): EligibilityReason {
  if (!isEvalPathContractValid(caseRecord.evidence.file_path)) {
    return "missing_or_path_contract_mismatch";
  }

  const evidencePath = normalizeEvalPath(caseRecord.evidence.file_path);
  const ledger = getLayerLedger(scan, caseRecord.layer);
  const outcome = outcomeForPath(ledger, caseRecord.evidence.file_path);
  if (outcome?.stage === "layer" && isSuccessfullyProcessed(outcome)) {
    return "successfully_processed";
  }

  const scopeRescue = (caseRecord.exhaustiveScopeFiles ?? []).some(
    (filePath) =>
      isEvalPathContractValid(filePath) &&
      normalizeEvalPath(filePath) === evidencePath,
  );
  if (scopeRescue) {
    return "successfully_processed";
  }

  return outcome?.reason ?? "missing_or_path_contract_mismatch";
}

export function isEvidenceReadable(caseRecord: EvalCase, scan?: FixtureScanResult): boolean {
  return evidenceEligibilityReason(caseRecord, scan) === "successfully_processed";
}

export function isUnread(caseRecord: EvalCase, scan?: FixtureScanResult): boolean {
  return !isEvidenceReadable(caseRecord, scan);
}

export function missingPathLayerOutcome(path: string): PathEligibilityOutcome {
  return layerOutcome(path, "missing_or_path_contract_mismatch");
}
