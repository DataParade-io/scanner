import type { DetectedComponent } from "../../../core/types/component";
import type { DetectedDataFlow } from "../../../core/types/data-flow";
import type { SourceLocation } from "../../../core/types/file";
import { buildScannerFinding } from "../record-factory";
import { parseTypedFlowKey } from "../graph/endpoints";
import type { AssertedFlowEndpoints } from "../graph/types";
import type { CanonicalScannerFinding, EvidenceLocation } from "../types";
import { componentScannerIdentityKey } from "./components";
import { resolveScannerAdapterMapVersion } from "./manifest";

function flowComponentIdentityKey(component: DetectedComponent): string {
  if (component.type === "third_party") {
    const vendor = component.properties?.vendor;
    if (typeof vendor === "string" && vendor.trim()) {
      return `${component.type}:${vendor.trim().toLowerCase()}`;
    }
    return componentScannerIdentityKey(component);
  }

  const subType = component.subType?.trim();
  if (subType) {
    return `${component.type}:${subType.toLowerCase()}`;
  }
  return componentScannerIdentityKey(component);
}

function collectSourceLocations(flow: DetectedDataFlow): SourceLocation[] {
  if (flow.sourceLocations && flow.sourceLocations.length > 0) {
    return flow.sourceLocations;
  }
  if (flow.sourceLocation) {
    return [flow.sourceLocation];
  }
  return [];
}

function toEvidenceLocation(location: SourceLocation): EvidenceLocation {
  return {
    file_path: location.filePath,
    start_line: location.startLine,
    end_line: location.endLine,
  };
}

export function dataFlowScannerIdentityKey(
  flow: DetectedDataFlow,
  componentsById: Map<string, DetectedComponent>,
): string {
  const source = componentsById.get(flow.sourceComponentId);
  const target = componentsById.get(flow.targetComponentId);
  const sourceKey = source ? flowComponentIdentityKey(source) : flow.sourceComponentId;
  const targetKey = target ? flowComponentIdentityKey(target) : flow.targetComponentId;
  return `flow:${sourceKey}->${targetKey}`;
}

function enrichFlowEndpointsWithSubtypes(
  endpoints: AssertedFlowEndpoints,
  flow: DetectedDataFlow,
  componentsById: Map<string, DetectedComponent>,
): AssertedFlowEndpoints {
  const source = componentsById.get(flow.sourceComponentId);
  const target = componentsById.get(flow.targetComponentId);

  const sourceEndpointKey = endpointKeyForFlowComponent(source, endpoints.source.endpointKey);
  const targetEndpointKey = endpointKeyForFlowComponent(target, endpoints.target.endpointKey);
  const sourceSubtype = source?.subType?.trim();
  const targetSubtype = target?.subType?.trim();

  return {
    source: {
      ...endpoints.source,
      endpointKey: sourceEndpointKey,
      componentSubtype: sourceSubtype || endpoints.source.componentSubtype,
    },
    target: {
      ...endpoints.target,
      endpointKey: targetEndpointKey,
      componentSubtype: targetSubtype || endpoints.target.componentSubtype,
    },
  };
}

function endpointKeyForFlowComponent(
  component: DetectedComponent | undefined,
  fallback: string,
): string {
  if (!component) {
    return fallback;
  }
  if (component.type === "third_party") {
    const vendor = component.properties?.vendor;
    if (typeof vendor === "string" && vendor.trim()) {
      return vendor.trim().toLowerCase();
    }
    return component.name.trim().toLowerCase() || fallback;
  }
  const subType = component.subType?.trim();
  if (subType) {
    return subType.toLowerCase();
  }
  return component.name.trim().toLowerCase() || fallback;
}

export function adaptDetectedDataFlow(
  flow: DetectedDataFlow,
  componentsById: Map<string, DetectedComponent>,
  adapterMapVersion: string = resolveScannerAdapterMapVersion(),
): CanonicalScannerFinding {
  const identityKey = dataFlowScannerIdentityKey(flow, componentsById);
  const evidenceLocations = collectSourceLocations(flow).map(toEvidenceLocation);
  const flowType = flow.type?.trim();
  const parsedEndpoints = parseTypedFlowKey(identityKey);
  const flowAssertion =
    flow.dataCategories && flow.dataCategories.length > 0
      ? { dataCategories: [...flow.dataCategories] }
      : undefined;

  const shared = {
    layer: "data-flows" as const,
    identityKey,
    evidenceLocations,
    flowAssertion,
    adapterMapVersion,
  };

  if (!flowType) {
    const baseFinding = buildScannerFinding({
      ...shared,
      conceptLeaf: "",
      conceptAncestry: [],
      declaredCapabilitySupported: {
        supported: false,
        reason: "missing_flow_type",
      },
    });
    if (parsedEndpoints.parsed) {
      return {
        ...baseFinding,
        flowEndpoints: enrichFlowEndpointsWithSubtypes(
          parsedEndpoints.endpoints,
          flow,
          componentsById,
        ),
      };
    }
    return baseFinding;
  }

  if (parsedEndpoints.parsed) {
    return buildScannerFinding({
      ...shared,
      conceptLeaf: flowType,
      conceptAncestry: [flowType],
      flowEndpoints: enrichFlowEndpointsWithSubtypes(
        parsedEndpoints.endpoints,
        flow,
        componentsById,
      ),
    });
  }

  return buildScannerFinding({
    ...shared,
    conceptLeaf: flowType,
    conceptAncestry: [flowType],
  });
}
