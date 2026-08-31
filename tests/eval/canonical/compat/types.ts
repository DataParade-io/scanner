import type {
  AnnotationStatus,
  BenchmarkLayer,
  ReviewState,
} from "../../../benchmark/schema";
import type { CANONICAL_CONTRACT_VERSION } from "../contract";
import type { CanonicalGoldExpectation, EvidenceLocation } from "../types";
import type { LEGACY_SOURCE_CONTRACT_VERSION } from "./contract";

export type ConversionKind =
  | "corpus_layer_to_canonical"
  | "pii_signal_prefix_rewrite"
  | "pii_mention_key_exemption"
  | "canonical_subject_key"
  | "legacy_subject_name"
  | "expected_labels_provenance"
  | "expected_status_disposition";

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
}
