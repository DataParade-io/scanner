import type { ScanResult } from "../core/types/result";
import { mapDetectedComponent } from "./map-component";
import { mapDetectedDataFlow } from "./map-data-flow";
import { resolveDiscoveryAdapterVersion } from "./manifest";
import { ONTOLOGY_SHA, ONTOLOGY_TAG, ONTOLOGY_VERSION } from "./ontology-pin";
import {
  scanDiscoveryExportSchema,
  type ScanDiscoveryExport,
  type ScanDiscoveryRecord,
  type ScanEntity,
} from "./types";

export interface ExportScanDiscoveriesOptions {
  /**
   * ISO-8601 timestamp for Discovery.asserted_at. Defaults to scan export time.
   * Pass a fixed value in tests for deterministic fixtures.
   */
  assertedAt?: string;
  adapterVersion?: string;
}

function sortEntities(entities: ScanEntity[]): ScanEntity[] {
  return [...entities].sort((a, b) => a.scanner_id.localeCompare(b.scanner_id));
}

function sortDiscoveries(discoveries: ScanDiscoveryRecord[]): ScanDiscoveryRecord[] {
  return [...discoveries].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Export ontology 0.2.0 Discovery records (`source=scan` only) from a ScanResult.
 *
 * - Entities (`Actor`, `ExternalSystem`, `Component`, `SendsDataTo`) are emitted
 *   separately; Discovery records are sourced assertions about them.
 * - Duplicate third-party names (e.g. multiple Aws ids) each get their own entity
 *   and Discoveries — the adapter never merges mush ExternalSystems.
 * - RawFinding and OCSF Finding are not emitted on this path.
 */
export function exportScanDiscoveries(
  scanResult: ScanResult,
  options: ExportScanDiscoveriesOptions = {},
): ScanDiscoveryExport {
  const assertedAt = options.assertedAt ?? new Date().toISOString();
  const adapterVersion = options.adapterVersion ?? resolveDiscoveryAdapterVersion();

  const entities: ScanEntity[] = [];
  const discoveries: ScanDiscoveryRecord[] = [];

  for (const component of scanResult.components) {
    const mapped = mapDetectedComponent(component, assertedAt);
    entities.push(mapped.entity);
    discoveries.push(...mapped.discoveries);
  }

  for (const flow of scanResult.dataFlows) {
    const mapped = mapDetectedDataFlow(flow, assertedAt);
    entities.push(mapped.entity);
    discoveries.push(...mapped.discoveries);
  }

  const exportBundle: ScanDiscoveryExport = {
    export_kind: "scan_discovery_bundle",
    surface: "a0-data-flow",
    ontology_version: ONTOLOGY_VERSION,
    ontology_tag: ONTOLOGY_TAG,
    ontology_sha: ONTOLOGY_SHA,
    adapter_version: adapterVersion,
    entities: sortEntities(entities),
    discoveries: sortDiscoveries(discoveries),
  };

  return scanDiscoveryExportSchema.parse(exportBundle);
}
