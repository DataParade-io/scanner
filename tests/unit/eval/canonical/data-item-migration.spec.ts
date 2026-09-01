import type { AnnotationRecord } from "../../../benchmark/schema";
import {
  buildDataItemCandidate,
  buildDataItemMigrationLedger,
  classifyDataItemRow,
  isSourceTokenKeyedSuffix,
  lookupSuffixInConceptMap,
  shouldFlipReviewState,
} from "../../../eval/canonical/compat/data-item-migration";
import {
  annotationRecordToLegacyInput,
  isAcceptedEvaluablePositive,
  loadLegacyGoldRecord,
} from "../../../eval/canonical";

function dataItemRecord(
  overrides: Partial<AnnotationRecord> & Pick<AnnotationRecord, "id">,
): AnnotationRecord {
  return {
    layer: "data_items",
    subject: { key: "data_item:id", name: "id" },
    evidence: { file_path: "app/models/user.rb", start_line: 10, end_line: 10 },
    expected: { status: "positive", labels: ["user_identifier"] },
    rationale: "Primary key column",
    provenance: {
      proposed_by: "test",
      proposed_at: "2026-08-31",
      review_state: "accepted",
    },
    ...overrides,
  };
}

describe("data-item migration", () => {
  it("classifies source-token id rows as tier E without map match", () => {
    const bucket = classifyDataItemRow(dataItemRecord({ id: "tier-e" }), "verified").bucket;
    expect(bucket).toBe("tier_e_never_auto_map");
    expect(lookupSuffixInConceptMap("id")).toBeUndefined();
  });

  it("classifies label-guided mail row as tier B", () => {
    const bucket = classifyDataItemRow(
      dataItemRecord({
        id: "tier-b",
        subject: { key: "data_item:mail", name: "mail" },
        expected: { status: "positive", labels: ["email_address"] },
      }),
      "verified",
    ).bucket;
    expect(bucket).toBe("tier_b_label_guided");
  });

  it("classifies canonical suffix first_name as tier A", () => {
    const bucket = classifyDataItemRow(
      dataItemRecord({
        id: "tier-a",
        subject: { key: "data_item:first_name", name: "firstName" },
        expected: { status: "positive", labels: ["person_name"] },
      }),
      "verified",
    ).bucket;
    expect(bucket).toBe("tier_a_canonical_suffix");
  });

  it("builds candidate without rewriting subject.key", () => {
    const record = dataItemRecord({
      id: "candidate-row",
      subject: { key: "data_item:mail", name: "mail" },
      expected: { status: "positive", labels: ["email_address"] },
    });
    const candidate = buildDataItemCandidate(
      "tier_b_label_guided",
      lookupSuffixInConceptMap("email")!,
      "verified",
    );
    expect(candidate.proposed_identity_key).toBe("data_item:email");
    expect(candidate.proposed_concept_leaf).toBe("email_address");
    expect(record.subject.key).toBe("data_item:mail");
  });

  it("flips accepted rows when suffix is not in concept map", () => {
    expect(shouldFlipReviewState(dataItemRecord({ id: "flip" }))).toBe(true);
    expect(
      shouldFlipReviewState(
        dataItemRecord({
          id: "no-flip",
          subject: { key: "data_item:first_name", name: "firstName" },
        }),
      ),
    ).toBe(false);
  });

  it("does not promote data-item candidate to evaluable positive", () => {
    const { record } = loadLegacyGoldRecord(
      annotationRecordToLegacyInput(
        dataItemRecord({
          id: "non-scoring",
          subject: { key: "data_item:mail", name: "mail" },
          provenance: {
            proposed_by: "test",
            proposed_at: "2026-08-31",
            review_state: "needs_adjudication",
          },
          candidate: buildDataItemCandidate(
            "tier_b_label_guided",
            lookupSuffixInConceptMap("email")!,
            "verified",
          ),
        }),
      ),
      { warn: () => undefined },
    );

    expect(record.identity.identityKey).toBe("data_item:mail");
    expect(record.classification.conceptLeaf).toBe("mail");
    expect(isAcceptedEvaluablePositive(record)).toBe(false);
    expect(
      record.observedTokenCandidates?.some(
        (token) => token.provenance === "data-item-candidate-leaf",
      ),
    ).toBe(true);
  });

  it("ledger preserves 436 rows with bucket accounting", () => {
    const ledger = buildDataItemMigrationLedger();
    expect(ledger.totalRows).toBe(436);
    expect(ledger.entries).toHaveLength(436);
    const bucketSum = Object.values(ledger.buckets).reduce<number>(
      (sum, count) => sum + count,
      0,
    );
    expect(bucketSum).toBe(436);
    expect(ledger.sourceTokenNoMapMatch).toBeGreaterThanOrEqual(300);
  });

  it("tracks source-token keyed census separately from map match", () => {
    expect(isSourceTokenKeyedSuffix("id", "id")).toBe(true);
    expect(isSourceTokenKeyedSuffix("first_name", "firstName")).toBe(false);
    expect(isSourceTokenKeyedSuffix("username", "username")).toBe(true);
  });
});
