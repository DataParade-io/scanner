import type { DetectedDataFlow } from "../core/types/data-flow";
import type { SourceLocation } from "../core/types/file";
import { firstEvidenceRef, formatSourceLocation } from "./location";
import type { ScanDiscoveryRecord, ScanEntity } from "./types";
import { discoveryUri, entityUri } from "./uris";

function collectFlowLocations(flow: DetectedDataFlow): SourceLocation[] {
  if (flow.sourceLocations && flow.sourceLocations.length > 0) {
    return flow.sourceLocations;
  }
  if (flow.sourceLocation) {
    return [flow.sourceLocation];
  }
  return [];
}

export interface MappedDataFlow {
  entity: ScanEntity;
  discoveries: ScanDiscoveryRecord[];
}

export function mapDetectedDataFlow(flow: DetectedDataFlow, assertedAt: string): MappedDataFlow {
  const associationId = entityUri(flow.id);
  const locations = collectFlowLocations(flow);
  const evidencePattern = flow.type;

  const entity: ScanEntity = {
    id: associationId,
    class: "SendsDataTo",
    name: flow.description?.trim() || `${flow.sourceComponentId}->${flow.targetComponentId}`,
    scanner_id: flow.id,
    source_component_id: flow.sourceComponentId,
    target_component_id: flow.targetComponentId,
    flow_type: flow.type,
  };

  const discoveries: ScanDiscoveryRecord[] = [
    {
      id: discoveryUri(flow.id, "existence"),
      class: "Discovery",
      source: "scan",
      asserted_at: assertedAt,
      asserts: associationId,
      raw_evidence_ref: firstEvidenceRef(evidencePattern, locations),
      ...(locations[0] ? { location: formatSourceLocation(locations[0]) } : {}),
    },
    {
      id: discoveryUri(flow.id, "source"),
      class: "Discovery",
      source: "scan",
      asserted_at: assertedAt,
      asserts: associationId,
      asserted_slot: "source",
      asserted_value: entityUri(flow.sourceComponentId),
      raw_evidence_ref: firstEvidenceRef(evidencePattern, locations),
      ...(locations[0] ? { location: formatSourceLocation(locations[0]) } : {}),
    },
    {
      id: discoveryUri(flow.id, "target"),
      class: "Discovery",
      source: "scan",
      asserted_at: assertedAt,
      asserts: associationId,
      asserted_slot: "target",
      asserted_value: entityUri(flow.targetComponentId),
      raw_evidence_ref: firstEvidenceRef(evidencePattern, locations),
      ...(locations[0] ? { location: formatSourceLocation(locations[0]) } : {}),
    },
  ];

  if (flow.dataCategories && flow.dataCategories.length > 0) {
    discoveries.push({
      id: discoveryUri(flow.id, "data_categories"),
      class: "Discovery",
      source: "scan",
      asserted_at: assertedAt,
      asserts: associationId,
      asserted_slot: "data_categories",
      asserted_value: JSON.stringify(flow.dataCategories),
      raw_evidence_ref: firstEvidenceRef(evidencePattern, locations),
      ...(locations[0] ? { location: formatSourceLocation(locations[0]) } : {}),
    });
  }

  if (flow.processingPurpose && flow.processingPurpose.length > 0) {
    discoveries.push({
      id: discoveryUri(flow.id, "purpose"),
      class: "Discovery",
      source: "scan",
      asserted_at: assertedAt,
      asserts: associationId,
      asserted_slot: "purpose",
      asserted_value: JSON.stringify(flow.processingPurpose),
      raw_evidence_ref: firstEvidenceRef(evidencePattern, locations),
      ...(locations[0] ? { location: formatSourceLocation(locations[0]) } : {}),
    });
  }

  return { entity, discoveries };
}
