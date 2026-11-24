import type { SourceLocation } from "./file";

export type DataFlowType =
  | "api_call"
  | "database_query"
  | "message_queue"
  | "file_transfer"
  | "webhook"
  | "rpc"
  | "data_transfer";

export const FLOW_RELATIONSHIPS = [
  "invokes",
  "queries",
  "publishes",
  "consumes",
  "interacts",
  "authenticates_via",
  "exposes",
  "uses_in_process",
  "depends_on",
  "provisions",
] as const;

export type FlowRelationship = (typeof FLOW_RELATIONSHIPS)[number];

export const FLOW_PROTOCOLS = [
  "rest",
  "graphql",
  "grpc",
  "soap",
  "json_rpc",
  "mcp",
  "sql",
  "mongodb_wire",
  "redis",
  "kafka",
  "amqp",
  "mqtt",
  "smtp",
  "oauth_oidc",
  "otlp",
  "vendor_sdk",
  "unknown",
] as const;

export type FlowProtocol = (typeof FLOW_PROTOCOLS)[number];

export const FLOW_TRANSPORTS = [
  "https",
  "http",
  "websocket",
  "http2",
  "tcp_tls",
  "tcp",
  "stdio",
  "in_process",
  "unknown",
] as const;

export type FlowTransport = (typeof FLOW_TRANSPORTS)[number];

export const HUMAN_INTERACTION_CHANNELS = [
  "web_gui",
  "mobile_app",
  "desktop_app",
  "cli",
  "mcp",
  "api_direct",
  "email",
  "unknown",
] as const;

export type HumanInteractionChannel = (typeof HUMAN_INTERACTION_CHANNELS)[number];

/** One line of authentication evidence on a flow (DATAP-912). */
export interface FlowAuthenticationEvidence {
  kind: string;
  filePath: string;
  line: number;
}

/**
 * Authentication evidence on a flow (DATAP-912). `none_seen` means no evidence was found,
 * not that the flow is unauthenticated. Absent when the flow type is not checked.
 */
export interface FlowAuthentication {
  status: "seen" | "none_seen";
  kinds: string[];
  evidence: FlowAuthenticationEvidence[];
}

export type FlowControlEffect = "mitigates" | "weakens";

/**
 * One line of control evidence on a flow (DATAP-915): TLS, a timeout, plain HTTP.
 * "weakens" means the line removes a control.
 */
export interface FlowControlEvidence {
  control: string;
  effect: FlowControlEffect;
  filePath: string;
  line: number;
}

export interface DetectedDataFlow {
  id: string;
  sourceComponentId: string;
  targetComponentId: string;
  type: DataFlowType;
  description?: string;
  confidence: number;
  sourceLocation?: SourceLocation;
  sourceLocations?: SourceLocation[];
  method?: string;
  endpoint?: string;
  dataCategories?: string[];
  dataSubjectCategories?: string[];
  processingPurpose?: string[];
  actions?: string[];
  transformation?: string[];
  enrichmentConfidence?: number;
  enrichmentNotes?: string;
  targetScope?: "local" | "cross_section_internal" | "external" | "unknown";
  targetScopeConfidence?: "high" | "medium" | "low";
  targetScopeReason?: string;
  authentication?: FlowAuthentication;
  /** Control evidence (DATAP-915). Empty when nothing was seen; absent when not checked. */
  controls?: FlowControlEvidence[];
  relationship?: FlowRelationship;
  protocol?: FlowProtocol;
  transport?: FlowTransport;
  client?: string;
  channel?: HumanInteractionChannel;
}

