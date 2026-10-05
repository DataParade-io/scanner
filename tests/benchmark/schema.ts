/** Ground-truth benchmark corpus types — mirrors ground-truth-schema.md */

export type ReviewState =
  | "proposed"
  | "accepted"
  | "rejected"
  | "needs_adjudication";

export type AnnotationStatus = "positive" | "negative" | "ambiguous";

export type BenchmarkLayer =
  | "components"
  | "data_flows"
  | "raw_hits"
  | "occurrences"
  | "data_items"
  | "data_actions"
  /** @deprecated Use `occurrences` — kept for corpus manifests and annotation files. */
  | "pii_signals"
  /** @deprecated Renamed to `occurrences` (KDATAP-3f9029); still read from older files. */
  | "mentions";

export interface ScopeExclude {
  path: string;
  reason: string;
}

export interface BenchmarkManifest {
  repository: string;
  commit: string;
  license: string;
  scope: {
    include: string[];
    exclude?: ScopeExclude[];
  };
  coverage: {
    layers: BenchmarkLayer[];
    languages: string[];
    domains: string[];
  };
  selection_rationale: string;
  annotation_version: number;
}

export interface AnnotationSubject {
  key: string;
  name?: string;
}

export interface AnnotationEvidence {
  file_path: string;
  start_line: number;
  end_line: number;
}

export interface AnnotationExpected {
  status: AnnotationStatus;
  labels: string[];
}

/** Reviewed closed-world precision scope for one corpus layer in a packet. */
export interface LayerScopeRecord {
  exhaustive_scope_files: string[];
  provenance: AnnotationProvenance;
}

/**
 * Closed-world scope for one concept (KDATAP-ec05ea): in these files, every scanner
 * finding whose subject key is listed counts toward precision. Findings for other
 * concepts in the same files are ignored unless a layer-wide scope also covers them.
 */
export interface ConceptScopeRecord {
  subject_keys: string[];
  exhaustive_scope_files: string[];
  provenance: AnnotationProvenance;
}

export interface PacketLayerScopes {
  layer_scopes: Partial<Record<BenchmarkLayer, LayerScopeRecord>>;
  concept_scopes?: Partial<Record<BenchmarkLayer, ConceptScopeRecord[]>>;
}

export interface AnnotationProvenance {
  proposed_by: string;
  proposed_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
  review_state: ReviewState;
}

/** Structured component identity written by KDATAP-8aed54 migration. */
export interface AnnotationCanonical {
  entity_id: string;
  identity_key: string;
  component_type: string;
  component_subtype: string;
  vendor?: string;
}

export type FlowDispositionCandidate =
  | "graph_edge"
  | "intra_component_lineage"
  | "rejection"
  | "unresolved";

export type FlowCandidateConfidence = "high" | "medium" | "low";

/** Serialized typed endpoint in flow candidate YAML (snake_case). */
export interface FlowCandidateEndpoint {
  component_type: string;
  endpoint_key: string;
  component_subtype?: string;
  vendor?: string;
}

/** Structured flow identity written by KDATAP-7e5b94 promotion. */
export interface FlowAnnotationCanonical {
  identity_key: string;
  disposition_candidate: FlowDispositionCandidate;
  source_entity_id: string;
  target_entity_id: string;
  endpoints: {
    source: FlowCandidateEndpoint;
    target: FlowCandidateEndpoint;
  };
  flow_type?: string;
  data_categories?: string[];
}

/** Non-scoring flow migration proposals (KDATAP-8e7756). */
export interface FlowAnnotationCandidate {
  kind: "flow";
  disposition_candidate: FlowDispositionCandidate;
  candidate_confidence: FlowCandidateConfidence;
  candidate_notes: string;
  candidate_identity_key?: string;
  proposed_flow_type?: string;
  proposed_data_categories?: string[];
  source_entity_id?: string;
  target_entity_id?: string;
  endpoints?: {
    source: FlowCandidateEndpoint;
    target: FlowCandidateEndpoint;
  };
}

export type DataItemEvidenceValidation =
  | "verified"
  | "unverified"
  | "contradicted"
  | "skipped";

/** Non-scoring data-item migration proposals (KDATAP-a0e80b). */
export interface DataItemAnnotationCandidate {
  kind: "data_item";
  proposed_identity_key: string;
  proposed_concept_leaf: string;
  proposed_ancestry: string[];
  candidate_confidence?: FlowCandidateConfidence;
  candidate_notes?: string;
  evidence_validation?: DataItemEvidenceValidation;
}

export type AnnotationCandidate = FlowAnnotationCandidate | DataItemAnnotationCandidate;

export type OccurrencesyntaxKind =
  | "identifier"
  | "property_key"
  | "string_literal"
  | "import_specifier"
  | "comment"
  | "type_name";

export type OccurrenceDeclarationKind =
  | "local"
  | "parameter"
  | "field"
  | "function"
  | "class"
  | "export";

export interface ResolvedOccurrenceDeclaration {
  file_path: string;
  line: number;
  kind: OccurrenceDeclarationKind;
}

/** `unresolved` when the declaration is outside the repo or more than one import hop away. */
export type OccurrenceDeclaration = ResolvedOccurrenceDeclaration | "unresolved";

/**
 * Optional asserted attributes on occurrence gold (KDATAP-8b2c8a). A record asserts only
 * the attributes it labels; each is scored over the gold that asserts it.
 */
export interface OccurrenceAttributes {
  syntax_kind?: OccurrencesyntaxKind;
  declaration?: OccurrenceDeclaration;
  /** Written type name on the declaration, when one is written. */
  type_annotation?: string;
  /** Repo-local name of the owning code unit. */
  owner?: string;
  /** Component identity keys the line touches. */
  touches?: string[];
  /** Repo-local declaration-group id for the grouping layer. */
  group?: string;
}

export interface AnnotationRecord {
  id: string;
  layer: BenchmarkLayer;
  subject: AnnotationSubject;
  evidence: AnnotationEvidence;
  rationale: string;
  expected: AnnotationExpected;
  provenance: AnnotationProvenance;
  canonical?: AnnotationCanonical;
  flow_canonical?: FlowAnnotationCanonical;
  candidate?: AnnotationCandidate;
  occurrence_attributes?: OccurrenceAttributes;
}

export interface AnnotationFile {
  annotations: AnnotationRecord[];
}

export const REVIEW_STATES: readonly ReviewState[] = [
  "proposed",
  "accepted",
  "rejected",
  "needs_adjudication",
];

export const ANNOTATION_STATUSES: readonly AnnotationStatus[] = [
  "positive",
  "negative",
  "ambiguous",
];

export const OCCURRENCE_SYNTAX_KINDS: readonly OccurrencesyntaxKind[] = [
  "identifier",
  "property_key",
  "string_literal",
  "import_specifier",
  "comment",
  "type_name",
];

export const OCCURRENCE_DECLARATION_KINDS: readonly OccurrenceDeclarationKind[] = [
  "local",
  "parameter",
  "field",
  "function",
  "class",
  "export",
];

export const BENCHMARK_LAYERS: readonly BenchmarkLayer[] = [
  "components",
  "data_flows",
  "raw_hits",
  "occurrences",
  "data_items",
  "data_actions",
  "pii_signals",
  "mentions",
];

/** Canonical layer for deprecated `pii_signals` and `mentions` corpus entries. */
export function normalizeBenchmarkLayer(layer: string): BenchmarkLayer {
  if (layer === "pii_signals" || layer === "mentions") {
    return "occurrences";
  }
  if (!BENCHMARK_LAYERS.includes(layer as BenchmarkLayer)) {
    throw new Error(`Unknown benchmark layer '${layer}'`);
  }
  return layer as BenchmarkLayer;
}
