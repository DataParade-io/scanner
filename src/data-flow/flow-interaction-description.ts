import type { DetectedComponent } from "../core/types/component";
import type {
  DataFlowType,
  DetectedDataFlow,
  FlowProtocol,
  FlowRelationship,
  FlowTransport,
} from "../core/types/data-flow";
import type { RawFinding } from "../core/types/detection";

export interface FlowInteractionDescription {
  relationship?: FlowRelationship;
  protocol?: FlowProtocol;
  transport?: FlowTransport;
  client?: string;
}

const HTTP_CLIENT_LIBRARY_NAMES = new Set([
  "fetch",
  "axios",
  "got",
  "superagent",
  "node-fetch",
  "undici",
  "ky",
  "requests",
  "httpx",
  "aiohttp",
  "urllib",
  "urllib3",
  "net/http",
  "resty",
  "httpclient",
  "okhttp",
  "resttemplate",
  "webclient",
  "guzzle",
  "faraday",
  "httparty",
  "curl",
]);

const GRAPHQL_URL_PATTERN = /\bgraphql\b|\/graphql\b/i;

const PROTOCOL_BY_FINDING_TRANSPORT_PROPERTY: Record<string, FlowProtocol> = {
  mcp_http: "mcp",
  mcp_stdio: "mcp",
  otlp: "otlp",
  grpc: "grpc",
};

const TRANSPORT_BY_FINDING_TRANSPORT_PROPERTY: Record<string, FlowTransport> = {
  mcp_stdio: "stdio",
};

const PROTOCOL_BY_DATABASE_ENGINE_NAME: Array<[RegExp, FlowProtocol]> = [
  [/postgres|pg\b|mysql|mariadb|sqlite|mssql|sql ?server|oracle|cockroach|aurora|^sql$|jdbc|sequelize|typeorm|prisma|knex|activerecord|django/i, "sql"],
  [/mongo/i, "mongodb_wire"],
  [/redis|valkey|elasticache/i, "redis"],
  [/kafka|msk/i, "kafka"],
  [/rabbit|amqp/i, "amqp"],
  [/mqtt/i, "mqtt"],
];

function readStringProperty(
  properties: Record<string, unknown> | undefined,
  propertyName: string,
): string | undefined {
  const value = properties?.[propertyName];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function transportFromUrlScheme(url: string | undefined): FlowTransport | undefined {
  if (!url) return undefined;
  const lowerCaseUrl = url.trim().toLowerCase();
  if (lowerCaseUrl.startsWith("https://")) return "https";
  if (lowerCaseUrl.startsWith("wss://") || lowerCaseUrl.startsWith("ws://")) return "websocket";
  if (lowerCaseUrl.startsWith("http://")) return "http";
  return undefined;
}

export function protocolForDatabaseEngineName(
  databaseEngineName: string | undefined,
): FlowProtocol | undefined {
  if (!databaseEngineName) return undefined;
  for (const [engineNamePattern, protocol] of PROTOCOL_BY_DATABASE_ENGINE_NAME) {
    if (engineNamePattern.test(databaseEngineName)) return protocol;
  }
  return undefined;
}

function isHttpClientLibraryName(clientName: string | undefined): boolean {
  return clientName !== undefined && HTTP_CLIENT_LIBRARY_NAMES.has(clientName.toLowerCase());
}

function describeOutboundCallFinding(finding: RawFinding): FlowInteractionDescription {
  const properties = finding.properties;
  const url = readStringProperty(properties, "url");
  const findingTransportProperty = readStringProperty(properties, "transport");
  const httpClientLibrary = readStringProperty(properties, "httpClientLibrary");
  const clientProperty = readStringProperty(properties, "client");
  // The SDK package the call imports. `package_name` is the scanned section's own package,
  // so it never names the client.
  const sdkPackage = readStringProperty(properties, "sdkPackage");
  const serviceName = readStringProperty(properties, "serviceName");

  const description: FlowInteractionDescription = { relationship: "invokes" };

  const protocolFromTransportProperty = findingTransportProperty
    ? PROTOCOL_BY_FINDING_TRANSPORT_PROPERTY[findingTransportProperty]
    : undefined;
  const callsThroughHttpClientLibrary =
    httpClientLibrary !== undefined || isHttpClientLibraryName(clientProperty);

  if (protocolFromTransportProperty) {
    description.protocol = protocolFromTransportProperty;
  } else if (url && GRAPHQL_URL_PATTERN.test(url)) {
    description.protocol = "graphql";
  } else if (!callsThroughHttpClientLibrary && serviceName) {
    description.protocol = "vendor_sdk";
  }

  description.transport =
    (findingTransportProperty
      ? TRANSPORT_BY_FINDING_TRANSPORT_PROPERTY[findingTransportProperty]
      : undefined) ?? transportFromUrlScheme(url);

  description.client = callsThroughHttpClientLibrary
    ? (httpClientLibrary ?? clientProperty)
    : (sdkPackage ?? clientProperty ?? serviceName);

  return description;
}

function describeDatabaseConnectionFinding(
  finding: RawFinding,
  targetComponent: DetectedComponent | undefined,
): FlowInteractionDescription {
  const databaseEngineName =
    readStringProperty(finding.properties, "databaseType") ??
    readStringProperty(targetComponent?.properties, "databaseType") ??
    readStringProperty(targetComponent?.properties, "database_engine");
  return {
    relationship: "queries",
    protocol: protocolForDatabaseEngineName(databaseEngineName),
    client: readStringProperty(finding.properties, "client"),
  };
}

function isInternalFetchFinding(finding: RawFinding): boolean {
  return finding.pattern === "express_route" && finding.name.startsWith("INTERNAL_FETCH ");
}

export function describeFlowFromFinding(
  finding: RawFinding,
  flowType: DataFlowType,
  sourceComponent: DetectedComponent,
  targetComponent: DetectedComponent,
): FlowInteractionDescription {
  if (sourceComponent.type === "actor") return { relationship: "interacts" };
  if (finding.pattern === "database_connection") {
    return describeDatabaseConnectionFinding(finding, targetComponent);
  }
  if (finding.pattern === "external_api_call") return describeOutboundCallFinding(finding);
  if (finding.pattern === "auth_middleware") return { relationship: "authenticates_via" };
  if (isInternalFetchFinding(finding)) {
    const url = readStringProperty(finding.properties, "url");
    // A path alone does not say REST, so only GraphQL is named (DATAP-937).
    return {
      relationship: "invokes",
      protocol: url && GRAPHQL_URL_PATTERN.test(url) ? "graphql" : "unknown",
      transport: transportFromUrlScheme(url),
      client: "fetch",
    };
  }
  if (finding.pattern === "express_route") return { relationship: "exposes" };
  return { relationship: relationshipForFlowTypeWithEvidence(flowType) };
}

function relationshipForFlowTypeWithEvidence(flowType: DataFlowType): FlowRelationship {
  if (flowType === "database_query") return "queries";
  if (flowType === "message_queue") return "publishes";
  if (flowType === "data_transfer") return "uses_in_process";
  return "invokes";
}

function flowHasCodeEvidence(flow: DetectedDataFlow): boolean {
  return flow.sourceLocation !== undefined || (flow.sourceLocations?.length ?? 0) > 0;
}

function inferRelationshipForFlowWithoutOne(
  flow: DetectedDataFlow,
  componentsById: Map<string, DetectedComponent>,
): FlowRelationship {
  const sourceComponent = componentsById.get(flow.sourceComponentId);
  if (sourceComponent?.type === "actor") return "interacts";
  if (flow.type !== "api_call") return relationshipForFlowTypeWithEvidence(flow.type);
  return flowHasCodeEvidence(flow) ? "invokes" : "depends_on";
}

export function completeFlowInteractionDescriptions(
  flows: DetectedDataFlow[],
  components: DetectedComponent[],
): void {
  const componentsById = new Map(components.map((component) => [component.id, component]));
  for (const flow of flows) {
    const sourceComponent = componentsById.get(flow.sourceComponentId);
    if (sourceComponent?.type === "actor") {
      flow.relationship = "interacts";
    } else if (!flow.relationship) {
      flow.relationship = inferRelationshipForFlowWithoutOne(flow, componentsById);
    }
    if (!flow.protocol && flow.relationship === "queries") {
      const targetComponent = componentsById.get(flow.targetComponentId);
      const protocol = protocolForDatabaseEngineName(
        readStringProperty(targetComponent?.properties, "databaseType") ??
          readStringProperty(targetComponent?.properties, "database_engine"),
      );
      if (protocol) flow.protocol = protocol;
    }
    if (!flow.transport && flow.relationship === "uses_in_process") {
      flow.transport = "in_process";
    }
  }
}

const PROTOCOL_DISPLAY_NAMES: Record<FlowProtocol, string> = {
  rest: "REST",
  graphql: "GraphQL",
  grpc: "gRPC",
  soap: "SOAP",
  json_rpc: "JSON-RPC",
  mcp: "MCP",
  sql: "SQL",
  mongodb_wire: "MongoDB",
  redis: "Redis",
  kafka: "Kafka",
  amqp: "AMQP",
  mqtt: "MQTT",
  smtp: "SMTP",
  oauth_oidc: "OAuth/OIDC",
  otlp: "OTLP",
  vendor_sdk: "Vendor SDK",
  unknown: "",
};

const TRANSPORT_DISPLAY_NAMES: Record<FlowTransport, string> = {
  https: "HTTPS",
  http: "HTTP",
  websocket: "WebSocket",
  http2: "HTTP/2",
  tcp_tls: "TLS",
  tcp: "TCP",
  stdio: "stdio",
  in_process: "",
  unknown: "",
};

const RELATIONSHIP_DISPLAY_NAMES_FOR_STRUCTURAL_EDGES: Partial<Record<FlowRelationship, string>> = {
  uses_in_process: "uses",
  exposes: "exposes",
  authenticates_via: "authenticates via",
  depends_on: "depends on",
  provisions: "provisions",
};

const CHANNEL_DISPLAY_NAMES: Record<string, string> = {
  web_gui: "Web GUI",
  mobile_app: "Mobile app",
  desktop_app: "Desktop app",
  cli: "CLI",
  mcp: "MCP",
  api_direct: "Direct API",
  email: "Email",
};

function joinProtocolAndTransport(protocolName: string, transportName: string): string {
  if (protocolName && transportName) return `${protocolName} · ${transportName}`;
  return protocolName || transportName;
}

export function flowInteractionLabel(flow: DetectedDataFlow): string {
  const structuralRelationshipName = flow.relationship
    ? RELATIONSHIP_DISPLAY_NAMES_FOR_STRUCTURAL_EDGES[flow.relationship]
    : undefined;
  if (structuralRelationshipName) return structuralRelationshipName;

  if (flow.relationship === "interacts") {
    return (flow.channel && CHANNEL_DISPLAY_NAMES[flow.channel]) || "interacts";
  }

  const transportName = flow.transport ? TRANSPORT_DISPLAY_NAMES[flow.transport] : "";
  const protocolName = flow.protocol ? PROTOCOL_DISPLAY_NAMES[flow.protocol] : "";
  const protocolAndTransport = joinProtocolAndTransport(protocolName, transportName);
  if (protocolAndTransport && protocolName) return protocolAndTransport;

  if (isHttpClientLibraryName(flow.client)) {
    return flow.transport === "https" ? "HTTPS request" : "HTTP request";
  }
  if (protocolAndTransport) return protocolAndTransport;
  return flow.type.replace(/_/g, " ");
}
