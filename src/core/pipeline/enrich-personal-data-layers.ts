import {
  buildPersonalDataInventory,
  buildPersonalDataInventoryFromIngest,
} from "../../eval-layers/personal-data-inventory";
import { buildScanPersonalDataLayers } from "./build-scan-personal-data-layers";
import type { OrchestratorScanResult } from "./orchestrator-result";

export async function enrichOrchestratorResultWithPersonalDataLayers(
  rootPath: string,
  result: OrchestratorScanResult,
): Promise<OrchestratorScanResult> {
  const inventory = result.ledgerContext
    ? buildPersonalDataInventoryFromIngest(
        result.ledgerContext.allIngestedFiles,
        result.ledgerContext.ingestOutcomes,
      )
    : await buildPersonalDataInventory(rootPath);
  const { mentions, dataItems } = buildScanPersonalDataLayers(inventory);
  return { ...result, mentions, dataItems };
}
