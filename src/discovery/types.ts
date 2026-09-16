import { z } from "zod";

/** Immutable scan channel — only value the scanner adapter may emit. */
export const discoverySourceSchema = z.literal("scan");
export type DiscoverySource = z.infer<typeof discoverySourceSchema>;

export const ontologyEntityClassSchema = z.enum([
  "Actor",
  "ExternalSystem",
  "Component",
  "SendsDataTo",
]);
export type OntologyEntityClass = z.infer<typeof ontologyEntityClassSchema>;

export const scanEntitySchema = z.object({
  id: z.string().min(1),
  class: ontologyEntityClassSchema,
  name: z.string(),
  scanner_id: z.string().min(1),
  scanner_component_type: z.enum(["asset", "actor", "third_party"]).optional(),
  scanner_sub_type: z.string().optional(),
  source_component_id: z.string().optional(),
  target_component_id: z.string().optional(),
  flow_type: z.string().optional(),
});
export type ScanEntity = z.infer<typeof scanEntitySchema>;

export const scanDiscoveryRecordSchema = z.object({
  id: z.string().min(1),
  class: z.literal("Discovery"),
  source: discoverySourceSchema,
  asserted_at: z.string().datetime(),
  asserts: z.string().min(1),
  asserted_slot: z.string().optional(),
  asserted_value: z.string().optional(),
  location: z.string().optional(),
  raw_evidence_ref: z.string().min(1),
});
export type ScanDiscoveryRecord = z.infer<typeof scanDiscoveryRecordSchema>;

export const scanDiscoveryExportSchema = z.object({
  export_kind: z.literal("scan_discovery_bundle"),
  surface: z.literal("a0-data-flow"),
  ontology_version: z.literal("0.2.0"),
  ontology_tag: z.literal("v0.2.0"),
  ontology_sha: z.literal("0656c5d9a6ce0d31440c63327ce597ce8df4414f"),
  adapter_version: z.string().min(1),
  entities: z.array(scanEntitySchema),
  discoveries: z.array(scanDiscoveryRecordSchema),
});
export type ScanDiscoveryExport = z.infer<typeof scanDiscoveryExportSchema>;
