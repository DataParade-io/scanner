import { buildPersonalDataInventory } from "../../eval-layers/personal-data-inventory";
import { buildScanPersonalDataLayers } from "./build-scan-personal-data-layers";
import type { OrchestratorScanResult } from "./orchestrator-result";

export async function enrichOrchestratorResultWithPersonalDataLayers(
  rootPath: string,
  result: OrchestratorScanResult,
): Promise<OrchestratorScanResult> {
  const inventory = await buildPersonalDataInventory(rootPath);
  const { mentions, dataItems } = buildScanPersonalDataLayers(inventory);
  return { ...result, mentions, dataItems };
}
