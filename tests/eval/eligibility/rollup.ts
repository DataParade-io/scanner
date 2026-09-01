import type { EvalLayer } from "../types";
import { normalizeEvalPath } from "../identity";
import { isSuccessfullyProcessed } from "../../../src/ingest/eligibility";
import type { EntityEvidenceCoverage, LayerEligibilityLedger } from "./types";
import { outcomeForPath } from "./ledger-access";

export function rollupEntityCoverage(
  entityKey: string,
  layer: EvalLayer,
  evidencePaths: string[],
  ledger: LayerEligibilityLedger | undefined,
): EntityEvidenceCoverage {
  const locations = evidencePaths.map((path) => {
    const normalized = normalizeEvalPath(path);
    const outcome = outcomeForPath(ledger, normalized);
    return {
      path: normalized,
      reason: outcome?.reason ?? "missing_or_path_contract_mismatch",
    };
  });

  const processedCount = locations.filter((location) =>
    isSuccessfullyProcessed({
      stage: "layer",
      path: location.path,
      reason: location.reason,
    }),
  ).length;

  let coverage: EntityEvidenceCoverage["coverage"];
  if (processedCount === 0) {
    coverage = "none";
  } else if (processedCount === locations.length) {
    coverage = "full";
  } else {
    coverage = "partial";
  }

  return {
    entityKey,
    layer,
    coverage,
    eligible: processedCount > 0,
    locations,
  };
}
