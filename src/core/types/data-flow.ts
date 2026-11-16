import type { SourceLocation } from "./file";

export type DataFlowType =
  | "api_call"
  | "database_query"
  | "message_queue"
  | "file_transfer"
  | "webhook"
  | "rpc"
  | "data_transfer";

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
}

