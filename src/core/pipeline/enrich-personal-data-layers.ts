import {
  buildPersonalDataInventory,
  buildPersonalDataInventoryFromIngest,
  ensureDeclarationEngine,
} from "../../eval-layers/personal-data-inventory";
import { buildScanPersonalDataLayers } from "./build-scan-personal-data-layers";
import type { OrchestratorScanResult } from "./orchestrator-result";

export async function enrichOrchestratorResultWithPersonalDataLayers(
  rootPath: string,
  result: OrchestratorScanResult,
): Promise<OrchestratorScanResult> {
  await ensureDeclarationEngine();
  const inventory = result.ledgerContext
    ? buildPersonalDataInventoryFromIngest(
        result.ledgerContext.allIngestedFiles,
        result.ledgerContext.ingestOutcomes,
      )
    : await buildPersonalDataInventory(rootPath);
  const { occurrences, dataItems } = buildScanPersonalDataLayers(inventory);
  return { ...result, occurrences, dataItems };
}
