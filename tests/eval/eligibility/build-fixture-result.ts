import type { EvalLayer, FixtureScanResult, LayerFinding } from "../types";
import { eligibleProcessedPaths } from "./ledger-access";
import type { PathEligibilityOutcome } from "../../../src/ingest/eligibility";
import { createLayerLedger, type LayerEligibilityLedger } from "./types";

export function fixtureScanResultWithLedger(
  fixture: string,
  findings: LayerFinding[],
  ledger: LayerEligibilityLedger,
): FixtureScanResult {
  return {
    fixture,
    findings,
    scannedFiles: eligibleProcessedPaths(ledger),
    eligibilityLedgers: {
      [ledger.layer]: ledger,
    },
  };
}

export function mergeFixtureLedgers(
  fixture: string,
  findings: LayerFinding[],
  ledgers: Partial<Record<EvalLayer, LayerEligibilityLedger>>,
): FixtureScanResult {
  const allPaths = new Set<string>();
  for (const ledger of Object.values(ledgers)) {
    if (!ledger) continue;
    for (const path of eligibleProcessedPaths(ledger)) {
      allPaths.add(path);
    }
  }

  return {
    fixture,
    findings,
    scannedFiles: [...allPaths].sort(),
    eligibilityLedgers: ledgers,
  };
}

export function layerLedgerFromOutcomes(
  layer: EvalLayer,
  outcomes: PathEligibilityOutcome[],
): LayerEligibilityLedger {
  return createLayerLedger(layer, outcomes);
}
