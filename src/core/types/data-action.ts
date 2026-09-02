import type { DataAction } from "../../data-actions/taxonomy";
import type { ComponentType } from "./component";
import type { SourceLocation } from "./file";

/** Field-level provenance for a data-action assignment (Interview F1 alignment). */
export type DataActionSource = "deterministic" | "ai" | "user";

/**
 * Asserted actions are facts for export / eval / rules.
 * Candidates are interview-handoff only and never gold-positive labels.
 */
export type DataActionAssignmentStatus = "asserted" | "candidate";

/** Topology-backed evidence kinds (distinct from file:line pattern hits). */
export type TopologyEvidenceKind =
  | "inbound_from_actor"
  | "outbound_to_third_party"
  | "storage_subtype"
  | "relay_topology"
  | "pattern_rule";

/**
 * Graph / rule facts that justify a verb without a single SourceLocation span.
 * `corroboration` is required before `relay` may be status `asserted` (conservative-absence rule).
 */
export interface TopologyEvidence {
  kind: TopologyEvidenceKind;
  /** Human-readable fact, e.g. "inbound from data-subject actor". */
  description: string;
  dataFlowId?: string;
  relatedComponentId?: string;
  ruleId?: string;
  /** Present when a candidate (e.g. topology-only relay) is promoted with extra proof. */
  corroboration?: string;
}

export type DataActionEvidence = SourceLocation[] | TopologyEvidence;

/**
 * One verb on a node with its own evidence, confidence, and provenance.
 * Nodes are set-valued: many assignments may coexist (PRD §4.2).
 */
export interface DataActionAssignment {
  action: DataAction;
  /** Transform only: reuse transformations vocab (`pseudonymized`, `anonymized`, …). */
  qualifier?: string;
  source: DataActionSource;
  confidence: number;
  evidence: DataActionEvidence;
  /** Defaults to asserted when omitted. */
  status?: DataActionAssignmentStatus;
}

/**
 * Typed slice of `DetectedComponent.properties` for privacy verbs.
 * Lives in the existing loose properties bag; actors never carry these fields (DA-1).
 */
export interface ComponentDataActionFields {
  dataActions?: DataActionAssignment[];
  /** Display only (badge / default chip); never a substitute for `dataActions` (DA-5). */
  primaryDataAction?: DataAction;
}

/** Component types that may carry `dataActions` in v1 (DA-1). */
export const DATA_ACTION_COMPONENT_TYPES = ["asset", "third_party"] as const;
export type DataActionComponentType = (typeof DATA_ACTION_COMPONENT_TYPES)[number];

const DATA_ACTION_COMPONENT_TYPE_SET: ReadonlySet<string> = new Set(
  DATA_ACTION_COMPONENT_TYPES,
);

/** Type guard: actors never receive `dataActions` (DA-1). */
export function componentMayCarryDataActions(
  type: ComponentType,
): type is DataActionComponentType {
  return DATA_ACTION_COMPONENT_TYPE_SET.has(type);
}
