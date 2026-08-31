import type { AnnotationRecord } from "../../../benchmark/schema";
import type { LegacyGoldRecord } from "./types";

/** Field-copy adapter only — no layer or key normalization. */
export function annotationRecordToLegacyInput(record: AnnotationRecord): LegacyGoldRecord {
  return {
    id: record.id,
    layer: record.layer,
    subject: {
      key: record.subject.key,
      name: record.subject.name,
    },
    evidence: {
      file_path: record.evidence.file_path,
      start_line: record.evidence.start_line,
      end_line: record.evidence.end_line,
    },
    expected: {
      status: record.expected.status,
      labels: [...record.expected.labels],
    },
    provenance: {
      proposed_by: record.provenance.proposed_by,
      proposed_at: record.provenance.proposed_at,
      reviewed_by: record.provenance.reviewed_by,
      reviewed_at: record.provenance.reviewed_at,
      review_state: record.provenance.review_state,
    },
  };
}
