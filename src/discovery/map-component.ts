import type { DetectedComponent, DetectedFromRef } from "../core/types/component";
import type { SourceLocation } from "../core/types/file";
import { firstEvidenceRef, formatPatternEvidenceRef, formatSourceLocation } from "./location";
import type { OntologyEntityClass, ScanDiscoveryRecord, ScanEntity } from "./types";
import { discoveryUri, entityUri } from "./uris";

function ontologyClassForComponent(component: DetectedComponent): OntologyEntityClass {
  switch (component.type) {
    case "actor":
      return "Actor";
    case "third_party":
      return "ExternalSystem";
    case "asset":
      return "Component";
  }
}

function collectComponentLocations(component: DetectedComponent): SourceLocation[] {
  const locations = [...component.sourceLocations];
  for (const ref of component.detectedFrom) {
    if (ref.sourceLocation) {
      locations.push(ref.sourceLocation);
    }
  }
  return locations;
}

function primaryPattern(component: DetectedComponent): string | undefined {
  return component.detectedFrom[0]?.pattern;
}

export interface MappedComponent {
  entity: ScanEntity;
  discoveries: ScanDiscoveryRecord[];
}

export function mapDetectedComponent(
  component: DetectedComponent,
  assertedAt: string,
): MappedComponent {
  const entityId = entityUri(component.id);
  const locations = collectComponentLocations(component);
  const pattern = primaryPattern(component);

  const entity: ScanEntity = {
    id: entityId,
    class: ontologyClassForComponent(component),
    name: component.name,
    scanner_id: component.id,
    scanner_component_type: component.type,
    ...(component.subType ? { scanner_sub_type: component.subType } : {}),
  };

  const discoveries: ScanDiscoveryRecord[] = [
    {
      id: discoveryUri(component.id, "existence"),
      class: "Discovery",
      source: "scan",
      asserted_at: assertedAt,
      asserts: entityId,
      raw_evidence_ref: firstEvidenceRef(pattern, locations),
      ...(locations[0] ? { location: formatSourceLocation(locations[0]) } : {}),
    },
  ];

  if (component.name.trim()) {
    discoveries.push({
      id: discoveryUri(component.id, "name"),
      class: "Discovery",
      source: "scan",
      asserted_at: assertedAt,
      asserts: entityId,
      asserted_slot: "name",
      asserted_value: component.name.trim(),
      raw_evidence_ref: firstEvidenceRef(pattern, locations),
      ...(locations[0] ? { location: formatSourceLocation(locations[0]) } : {}),
    });
  }

  component.detectedFrom.forEach((ref: DetectedFromRef, index: number) => {
    discoveries.push({
      id: discoveryUri(component.id, `pattern_${index}`),
      class: "Discovery",
      source: "scan",
      asserted_at: assertedAt,
      asserts: entityId,
      asserted_slot: "detected_from",
      asserted_value: ref.pattern,
      raw_evidence_ref: formatPatternEvidenceRef(ref.pattern, ref.sourceLocation),
      ...(ref.sourceLocation
        ? { location: formatSourceLocation(ref.sourceLocation) }
        : {}),
    });
  });

  return { entity, discoveries };
}
