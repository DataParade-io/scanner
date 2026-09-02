import type { CANONICAL_CONTRACT_VERSION } from "../../../../src/eval/canonical/contract";
import type { LEGACY_SOURCE_CONTRACT_VERSION } from "./contract";

/** Historical conversion step kinds retained for readiness accounting imports. */
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

export interface MigrationDiagnostic {
  annotationId: string;
  sourceContractVersion: typeof LEGACY_SOURCE_CONTRACT_VERSION;
  targetContractVersion: typeof CANONICAL_CONTRACT_VERSION;
  conversion: ConversionKind;
  detail: string;
}
