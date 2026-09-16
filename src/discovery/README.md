# Scan → ontology Discovery export (DATAP-686)

Adapter that turns scanner `ScanResult` graph output into ontology **0.2.0** `Discovery`
records with immutable `source=scan`.

**Ontology pin:** `v0.2.0` @ `0656c5d9a6ce0d31440c63327ce597ce8df4414f`

## What this is / is not

| Emits | Does not emit |
| --- | --- |
| `Discovery` with `source=scan` | OCSF `Finding` |
| Separate graph **entities** (`Actor`, `ExternalSystem`, `Component`, `SendsDataTo`) | Renamed `RawFinding` rows |
| `asserts`, optional `asserted_slot` / `asserted_value`, `asserted_at`, `raw_evidence_ref` | `source=interview` or `source=cloud` |
| One entity + Discoveries per scanner `cmp_*` / `flow_*` id | Merged mush ExternalSystems (duplicate names stay separate) |

**First surface:** A0 data-flow — `components` + `dataFlows` from `ScanResult`.
Personal-data layers and `RawFinding`-only exports are out of scope for this adapter.

## Usage

```ts
import { scan, createDefaultScanConfiguration } from "@dataparade/scanner";
import { exportScanDiscoveries } from "@dataparade/scanner/discovery";

const { scanResult } = await scan(repoRoot, createDefaultScanConfiguration());
const bundle = exportScanDiscoveries(scanResult);
// bundle.entities — ontology-shaped nodes/edges
// bundle.discoveries — sourced assertions (source=scan only)
```

## Sample shape

```json
{
  "export_kind": "scan_discovery_bundle",
  "surface": "a0-data-flow",
  "ontology_version": "0.2.0",
  "ontology_tag": "v0.2.0",
  "ontology_sha": "0656c5d9a6ce0d31440c63327ce597ce8df4414f",
  "entities": [
    {
      "id": "dp:scan/entity/cmp_3",
      "class": "ExternalSystem",
      "name": "Aws",
      "scanner_id": "cmp_3",
      "scanner_component_type": "third_party"
    }
  ],
  "discoveries": [
    {
      "id": "dp:discovery/scan/cmp_3/existence",
      "class": "Discovery",
      "source": "scan",
      "asserted_at": "2026-09-16T15:00:00.000Z",
      "asserts": "dp:scan/entity/cmp_3",
      "raw_evidence_ref": "scan:infra/main.tf:4-8",
      "location": "infra/main.tf:4-8"
    }
  ]
}
```

Duplicate third-party names (`cmp_3` Aws vs `cmp_11` Aws) each get their own entity URI and
Discovery set — the adapter does not collapse them.
