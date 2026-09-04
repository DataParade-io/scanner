import type { DetectedComponent, DetectedFromRef } from "../../../core/types/component";
import { buildScannerFinding } from "../record-factory";
import type { CanonicalScannerFinding, EvidenceLocation, ObservedTokenCandidate } from "../types";
import { resolveScannerAdapterMapVersion } from "./manifest";

export function componentScannerIdentityKey(component: DetectedComponent): string {
  const nameKey = component.name.toLowerCase();
  const subtype = component.subType?.trim().toLowerCase();

  if (component.type === "third_party") {
    return `${component.type}:${nameKey}`;
  }

  if (component.type === "asset" || component.type === "actor") {
    if (subtype) {
      return `${component.type}:${subtype}`;
    }
    return `${component.type}:${nameKey}`;
  }

  return `${component.type}:${nameKey}`;
}

function toEvidenceLocation(location: {
  filePath: string;
  startLine: number;
  endLine: number;
}): EvidenceLocation {
  return {
    file_path: location.filePath,
    start_line: location.startLine,
    end_line: location.endLine,
  };
}

function patternProvenanceTokens(
  component: DetectedComponent,
  evidenceLocations: EvidenceLocation[],
): ObservedTokenCandidate[] {
  if (evidenceLocations.length === 0) {
    return [];
  }
  return component.detectedFrom.map((ref: DetectedFromRef) => ({
    value: ref.pattern,
    evidenceRef: 0,
    provenance: "detector-pattern",
    validationState: "unverified" as const,
  }));
}

function resolveOptionalVendor(component: DetectedComponent): string | undefined {
  if (component.type !== "third_party") {
    return undefined;
  }
  const vendor = component.properties.vendor;
  if (typeof vendor !== "string" || vendor.trim().length === 0) {
    return undefined;
  }
  return vendor.trim().toLowerCase();
}

export function adaptDetectedComponent(
  component: DetectedComponent,
  adapterMapVersion: string = resolveScannerAdapterMapVersion(),
): CanonicalScannerFinding {
  const identityKey = componentScannerIdentityKey(component);
  const evidenceLocations = component.sourceLocations.map(toEvidenceLocation);
  const derivationLocations = component.detectedFrom
    .filter((ref: DetectedFromRef) => ref.sourceLocation !== undefined)
    .map((ref: DetectedFromRef) => toEvidenceLocation(ref.sourceLocation!));
  const observedTokenCandidates = patternProvenanceTokens(component, evidenceLocations);
  const subtype = component.subType?.trim();

  const optionalAssertionVendor = resolveOptionalVendor(component);
  const optionalAssertion =
    optionalAssertionVendor !== undefined ? { vendor: optionalAssertionVendor } : undefined;

  const base = {
    layer: "components" as const,
    identityKey,
    componentType: component.type,
    evidenceLocations,
    derivationLocations: derivationLocations.length > 0 ? derivationLocations : undefined,
    observedTokenCandidates:
      observedTokenCandidates.length > 0 ? observedTokenCandidates : undefined,
    displayText: component.name.trim() || undefined,
    optionalAssertion,
    adapterMapVersion,
  };

  if (!subtype) {
    return buildScannerFinding({
      ...base,
      conceptLeaf: "",
      conceptAncestry: [],
      declaredCapabilitySupported: {
        supported: false,
        reason: "missing_component_subtype",
      },
    });
  }

  return buildScannerFinding({
    ...base,
    conceptLeaf: subtype,
    conceptAncestry: [subtype],
    componentSubtype: subtype,
  });
}
