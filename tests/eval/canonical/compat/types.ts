import type {
  AnnotationCanonical,
  AnnotationCandidate,
  AnnotationStatus,
  BenchmarkLayer,
  FlowAnnotationCanonical,
  ReviewState,
} from "../../../benchmark/schema";
import type { CANONICAL_CONTRACT_VERSION } from "../../../../src/eval/canonical/contract";
import type { CanonicalGoldExpectation, EvidenceLocation } from "../../../../src/eval/canonical/types";
import type { LEGACY_SOURCE_CONTRACT_VERSION } from "./contract";

export type ConversionKind =
  | "corpus_layer_to_canonical"
  | "pii_signal_prefix_rewrite"
  | "canonical_subject_key"
  | "component_structured_identity"
  | "component_canonical_block"
  | "flow_canonical_block"
  | "rule_id_to_concept_leaf"
  | "legacy_subject_name"
  | "expected_labels_provenance"
  | "expected_status_disposition"
  | "flow_candidate_block"
  | "data_item_candidate_block";

export interface LegacyGoldProvenance {
  proposed_by: string;
  proposed_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
  review_state: ReviewState;
}

/** Legacy annotation row before canonical conversion (corpus layer names). */
export interface LegacyGoldRecord {
  id: string;
  layer: BenchmarkLayer;
  subject: { key: string; name?: string };
  evidence: EvidenceLocation;
  expected: { status: AnnotationStatus; labels: string[] };
  provenance: LegacyGoldProvenance;
  canonical?: AnnotationCanonical;
  flow_canonical?: FlowAnnotationCanonical;
  candidate?: AnnotationCandidate;
}

export interface MigrationDiagnostic {
  annotationId: string;
  sourceContractVersion: typeof LEGACY_SOURCE_CONTRACT_VERSION;
  targetContractVersion: typeof CANONICAL_CONTRACT_VERSION;
  conversion: ConversionKind;
  detail: string;
}

export interface CompatLoadResult {
  record: CanonicalGoldExpectation & { id: string };
  diagnostics: MigrationDiagnostic[];
}

export interface LoadLegacyGoldOptions {
  warn?: (message: string) => void;
  adapterMapVersion?: string;
  /** Corpus packet key — required for component entityId assignment. */
  repoKey?: string;
}
