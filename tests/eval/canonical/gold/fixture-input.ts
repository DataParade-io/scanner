import type { BenchmarkLayer } from "../../../benchmark/schema";
import type { EvalCase, EvalLayer } from "../../types";
import type { LegacyGoldRecord } from "../compat/types";

const EVAL_LAYER_TO_BENCHMARK: Record<EvalLayer, BenchmarkLayer> = {
  components: "components",
  "data-flows": "data_flows",
  "raw-hits": "raw_hits",
  "data-items": "data_items",
  mentions: "mentions",
  "data-actions": "data_actions",
};

const FIXTURE_GOLD_PROVENANCE: LegacyGoldRecord["provenance"] = {
  proposed_by: "fixture-gold",
  proposed_at: "2026-08-31T00:00:00.000Z",
  review_state: "accepted",
};

/** Map a committed Jest fixture EvalCase into the legacy gold shape for compat loading. */
export function evalCaseToLegacyInput(caseRecord: EvalCase): LegacyGoldRecord {
  return {
    id: caseRecord.id,
    layer: EVAL_LAYER_TO_BENCHMARK[caseRecord.layer],
    subject: {
      key: caseRecord.subject.key,
      ...(caseRecord.subject.name !== undefined ? { name: caseRecord.subject.name } : {}),
    },
    evidence: {
      file_path: caseRecord.evidence.file_path,
      start_line: caseRecord.evidence.start_line,
      end_line: caseRecord.evidence.end_line,
    },
    expected: {
      status: caseRecord.expected.status,
      labels: [...caseRecord.expected.labels],
    },
    provenance: FIXTURE_GOLD_PROVENANCE,
  };
}
