import type { EvalLayerId } from "./layer-capability";
import {
  buildOrchestratorLayerLedger,
  buildPersonalDataLayerLedger,
} from "./build-layer-ledger";
import type { OrchestratorLedgerContext } from "../core/pipeline/orchestrator-result";
import type { PathEligibilityOutcome } from "../ingest/eligibility";
import type { FileInfo } from "../core/types/file";

export function buildOrchestratorEvalLedgers(
  context: OrchestratorLedgerContext,
): Partial<Record<EvalLayerId, PathEligibilityOutcome[]>> {
  const input = {
    ingestOutcomes: context.ingestOutcomes,
    allIngestedFiles: context.allIngestedFiles,
    processedFiles: context.processedFiles,
    config: context.config,
    languageStats: context.languageStats,
  };

  return {
    components: buildOrchestratorLayerLedger("components", input),
    "data-flows": buildOrchestratorLayerLedger("data-flows", input),
  };
}

export function buildPersonalDataEvalLedger(
  layer: EvalLayerId,
  ingestOutcomes: PathEligibilityOutcome[],
  ingestedFiles: FileInfo[],
): PathEligibilityOutcome[] {
  return buildPersonalDataLayerLedger(layer, ingestOutcomes, ingestedFiles);
}
