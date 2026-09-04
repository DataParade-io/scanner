import type { AnnotationRecord } from "../../../benchmark/schema";
import {
  adjudicateDataItemRow,
  assertAcceptCeiling,
  validateFieldInEvidence,
} from "../../../eval/canonical/compat/data-item-adjudication";
import { classifyDataItemRow } from "../../../eval/canonical/compat/data-item-migration";

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
      review_state: "needs_adjudication",
    },
    ...overrides,
  };
}

describe("data-item adjudication", () => {
  it("validates field name in evidence span", () => {
    expect(validateFieldInEvidence("first_name", "firstName", "private String firstName;")).toBe(
      "verified",
    );
    expect(validateFieldInEvidence("phone_number", "mobile", "private String phoneNumber;")).toBe(
      "unverified",
    );
  });

  it("accepts tier A row when source verifies suffix", () => {
    const record = dataItemRecord({
      id: "tier-a",
      subject: { key: "data_item:first_name", name: "firstName" },
      expected: { status: "positive", labels: ["person_name"] },
    });
    const classified = classifyDataItemRow(record, "verified");
    const entry = adjudicateDataItemRow({
      repoKey: "fixture",
      record,
      sourceBucket: classified.bucket,
      span: "private String firstName;",
      contextSpan: "class User { private String firstName; }",
    });
    expect(entry.disposition).toBe("accept");
    expect(entry.conceptLeaf).toBe("first_name");
    expect(entry.confidence).toBe("high");
  });

  it("leaves password_verifier rows unresolved", () => {
    const record = dataItemRecord({
      id: "verifier",
      subject: { key: "data_item:password", name: "password" },
      expected: { status: "positive", labels: ["password_verifier"] },
    });
    const classified = classifyDataItemRow(record, "verified");
    const entry = adjudicateDataItemRow({
      repoKey: "fixture",
      record,
      sourceBucket: classified.bucket,
      span: "private String password;",
      contextSpan: "private String password;",
    });
    expect(entry.disposition).toBe("unresolved");
  });

  it("rejects negative metadata id fields", () => {
    const record = dataItemRecord({
      id: "negative-id",
      expected: { status: "negative", labels: [] },
      provenance: {
        proposed_by: "test",
        proposed_at: "2026-08-31",
        review_state: "proposed",
      },
    });
    const classified = classifyDataItemRow(record, "verified");
    const entry = adjudicateDataItemRow({
      repoKey: "fixture",
      record,
      sourceBucket: classified.bucket,
      span: "private Integer id;",
      contextSpan: "@Id private Integer id;",
    });
    expect(entry.disposition).toBe("reject");
  });

  it("marks ambiguous rows unresolved", () => {
    const record = dataItemRecord({
      id: "ambiguous",
      expected: { status: "ambiguous", labels: [] },
    });
    const classified = classifyDataItemRow(record, "skipped");
    const entry = adjudicateDataItemRow({
      repoKey: "fixture",
      record,
      sourceBucket: classified.bucket,
      span: "private String userLabel;",
      contextSpan: "private String userLabel;",
    });
    expect(entry.disposition).toBe("unresolved");
  });

  it("documents label correction for suffix-label conflict", () => {
    const record = dataItemRecord({
      id: "mislabeled-address",
      subject: { key: "data_item:address", name: "address" },
      expected: { status: "positive", labels: ["email_address"] },
    });
    const classified = classifyDataItemRow(record, "verified");
    expect(classified.bucket).toBe("tier_b_label_guided");
    const entry = adjudicateDataItemRow({
      repoKey: "fixture",
      record,
      sourceBucket: classified.bucket,
      span: "private String address;",
      contextSpan: "@Column private String address;",
    });
    expect(entry.disposition).toBe("accept");
    expect(entry.conceptLeaf).toBe("email_address");
    expect(entry.labelCorrection).toBeUndefined();
  });

  it("documents label correction when category label differs from map leaf", () => {
    const record = dataItemRecord({
      id: "person-name-first",
      subject: { key: "data_item:first_name", name: "firstName" },
      expected: { status: "positive", labels: ["person_name"] },
    });
    const classified = classifyDataItemRow(record, "verified");
    const entry = adjudicateDataItemRow({
      repoKey: "fixture",
      record,
      sourceBucket: classified.bucket,
      span: "private String firstName;",
      contextSpan: "private String firstName;",
    });
    expect(entry.disposition).toBe("accept");
    expect(entry.labelCorrection?.after).toEqual(["first_name"]);
  });

  it("assertAcceptCeiling throws when accepts exceed limit", () => {
    expect(() =>
      assertAcceptCeiling({
        task: "KDATAP-25b2f474-1d4a-4279-bfcc-b6a73343714a",
        totalRows: 1,
        acceptCeiling: 140,
        dispositions: { accept: 141, reject: 0, unresolved: 0 },
        bySourceBucket: {},
        labelCorrectionCount: 0,
        contestedCount: 0,
        entries: [],
      }),
    ).toThrow(/Accept ceiling exceeded/);
  });
});
