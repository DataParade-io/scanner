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
  | "mentions"
  | "data_items"
  /** @deprecated Use `mentions` — kept for corpus manifests and annotation files. */
  | "pii_signals";

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

export interface PacketLayerScopes {
  layer_scopes: Partial<Record<BenchmarkLayer, LayerScopeRecord>>;
}

export interface AnnotationProvenance {
  proposed_by: string;
  proposed_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
  review_state: ReviewState;
}

export interface AnnotationRecord {
  id: string;
  layer: BenchmarkLayer;
  subject: AnnotationSubject;
  evidence: AnnotationEvidence;
  rationale: string;
  expected: AnnotationExpected;
  provenance: AnnotationProvenance;
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

export const BENCHMARK_LAYERS: readonly BenchmarkLayer[] = [
  "components",
  "data_flows",
  "raw_hits",
  "mentions",
  "data_items",
  "pii_signals",
];

/** Canonical layer for deprecated `pii_signals` corpus entries. */
export function normalizeBenchmarkLayer(layer: string): BenchmarkLayer {
  if (layer === "pii_signals") {
    return "mentions";
  }
  if (!BENCHMARK_LAYERS.includes(layer as BenchmarkLayer)) {
    throw new Error(`Unknown benchmark layer '${layer}'`);
  }
  return layer as BenchmarkLayer;
}
