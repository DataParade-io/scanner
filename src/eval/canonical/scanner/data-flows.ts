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
    const subType = component.subType?.trim().toLowerCase();
    if (subType === "email_provider" || subType === "auth_provider") {
      return `${component.type}:${subType}`;
    }
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

function normalizeEvidencePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
}

function flowEvidenceCode(flow: DetectedDataFlow): string {
  if (flow.sourceLocation?.code?.trim()) {
    return flow.sourceLocation.code;
  }
  if (flow.sourceLocations?.length) {
    return flow.sourceLocations
      .map((location) => location.code ?? "")
      .filter((code) => code.trim().length > 0)
      .join("\n");
  }
  return "";
}

function flowEvidencePath(flow: DetectedDataFlow): string {
  const location = flow.sourceLocation ?? flow.sourceLocations?.[0];
  return location ? normalizeEvidencePath(location.filePath) : "";
}

/**
 * Full-repo scans often attach intra-component flows to coarse database or API
 * components while gold expects auth_service or email_provider identity keys.
 */
function inferIntraLineageEndpointKey(flow: DetectedDataFlow): string | undefined {
  const code = flowEvidenceCode(flow);
  const path = flowEvidencePath(flow);

  if (/webhooks\/sendgrid/i.test(code)) {
    return "third_party:email_provider";
  }

  if (!/(?:^|\/)app\/models\/.*\.rb$/i.test(path)) {
    return undefined;
  }

  if (/user_second_factor\.rb$/i.test(path) && /\bscope\s+:\w*totp/i.test(code)) {
    return "asset:auth_service";
  }
  if (/user_password\.rb$/i.test(path) && /password_validator|UserPasswordValidator/i.test(code)) {
    return "asset:auth_service";
  }
  if (/email_token\.rb$/i.test(path) && /^\s*class\s+EmailToken\b/m.test(code)) {
    return "asset:auth_service";
  }
  if (/api_key\.rb$/i.test(path) && /(?:hash_key|key_hash)/i.test(code)) {
    return "asset:auth_service";
  }

  return undefined;
}

export function dataFlowScannerIdentityKey(
  flow: DetectedDataFlow,
  componentsById: Map<string, DetectedComponent>,
): string {
  const inferredEndpoint = inferIntraLineageEndpointKey(flow);
  if (inferredEndpoint) {
    return `flow:${inferredEndpoint}->${inferredEndpoint}`;
  }

  const source = componentsById.get(flow.sourceComponentId);
  const target = componentsById.get(flow.targetComponentId);
  const sourceKey = source ? flowComponentIdentityKey(source) : flow.sourceComponentId;
  const targetKey = target ? flowComponentIdentityKey(target) : flow.targetComponentId;
  return `flow:${sourceKey}->${targetKey}`;
}

function resolveFlowEndpointVendor(
  flow: DetectedDataFlow,
  component?: DetectedComponent,
): string | undefined {
  const code = flowEvidenceCode(flow);
  const webhookMatch = code.match(/webhooks\/(sendgrid|mailgun|postmark|mandrill|sparkpost)/i);
  if (webhookMatch) {
    return webhookMatch[1]!.toLowerCase();
  }
  const vendor = component?.properties?.vendor;
  if (typeof vendor === "string" && vendor.trim()) {
    return vendor.trim().toLowerCase();
  }
  return undefined;
}

function enrichTypedFlowEndpoint(
  endpoint: AssertedFlowEndpoints["source"],
  vendor?: string,
): AssertedFlowEndpoints["source"] {
  const componentSubtype = endpoint.componentSubtype ?? endpoint.endpointKey;
  const optionalAssertion =
    vendor && endpoint.componentType === "third_party"
      ? { vendor, ...endpoint.optionalAssertion }
      : endpoint.optionalAssertion;
  return {
    ...endpoint,
    componentSubtype,
    ...(optionalAssertion ? { optionalAssertion } : {}),
  };
}

function enrichFlowEndpointsWithSubtypes(
  endpoints: AssertedFlowEndpoints,
  flow: DetectedDataFlow,
  componentsById: Map<string, DetectedComponent>,
): AssertedFlowEndpoints {
  const inferredEndpoint = inferIntraLineageEndpointKey(flow);
  if (inferredEndpoint) {
    const parsed = parseTypedFlowKey(`flow:${inferredEndpoint}->${inferredEndpoint}`);
    if (parsed.parsed) {
      const vendor = resolveFlowEndpointVendor(
        flow,
        componentsById.get(flow.sourceComponentId),
      );
      return {
        source: enrichTypedFlowEndpoint(parsed.endpoints.source, vendor),
        target: enrichTypedFlowEndpoint(parsed.endpoints.target, vendor),
      };
    }
  }

  const source = componentsById.get(flow.sourceComponentId);
  const target = componentsById.get(flow.targetComponentId);

  const sourceEndpointKey = endpointKeyForFlowComponent(source, endpoints.source.endpointKey);
  const targetEndpointKey = endpointKeyForFlowComponent(target, endpoints.target.endpointKey);
  const sourceSubtype = source?.subType?.trim();
  const targetSubtype = target?.subType?.trim();
  const sourceVendor = resolveFlowEndpointVendor(flow, source);
  const targetVendor = resolveFlowEndpointVendor(flow, target);

  return {
    source: enrichTypedFlowEndpoint(
      {
        ...endpoints.source,
        endpointKey: sourceEndpointKey,
        componentSubtype: sourceSubtype || endpoints.source.componentSubtype,
      },
      sourceVendor,
    ),
    target: enrichTypedFlowEndpoint(
      {
        ...endpoints.target,
        endpointKey: targetEndpointKey,
        componentSubtype: targetSubtype || endpoints.target.componentSubtype,
      },
      targetVendor,
    ),
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
    const subType = component.subType?.trim().toLowerCase();
    if (subType === "email_provider" || subType === "auth_provider") {
      return subType;
    }
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
