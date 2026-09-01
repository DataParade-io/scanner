import type { DetectedComponent } from "../../../core/types/component";
import type { DetectedDataFlow } from "../../../core/types/data-flow";
import type { SourceLocation } from "../../../core/types/file";
import { buildScannerFinding } from "../record-factory";
import { parseTypedFlowKey } from "../graph/endpoints";
import type { CanonicalScannerFinding, EvidenceLocation } from "../types";
import { componentScannerIdentityKey } from "./components";
import { resolveScannerAdapterMapVersion } from "./manifest";

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
  const sourceKey = source ? componentScannerIdentityKey(source) : flow.sourceComponentId;
  const targetKey = target ? componentScannerIdentityKey(target) : flow.targetComponentId;
  return `flow:${sourceKey}->${targetKey}`;
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
        flowEndpoints: parsedEndpoints.endpoints,
      };
    }
    return baseFinding;
  }

  if (parsedEndpoints.parsed) {
    return buildScannerFinding({
      ...shared,
      conceptLeaf: flowType,
      conceptAncestry: [flowType],
      flowEndpoints: parsedEndpoints.endpoints,
    });
  }

  return buildScannerFinding({
    ...shared,
    conceptLeaf: flowType,
    conceptAncestry: [flowType],
  });
}
