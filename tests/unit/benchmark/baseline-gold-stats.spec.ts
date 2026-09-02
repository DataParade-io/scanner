import path from "path";

import { loadCanonicalGoldFromAnnotation } from "../../eval/canonical";
import type { AnnotationRecord } from "../../benchmark/schema";
import {
  collectMigrationIncompleteAccounting,
  collectReviewStateCounts,
} from "../../benchmark/baseline/collect-gold-stats";

function annotation(
  overrides: Partial<AnnotationRecord> & Pick<AnnotationRecord, "id" | "layer">,
): AnnotationRecord {
  return {
    subject: { key: "mention:email" },
    evidence: { file_path: "src/a.ts", start_line: 1, end_line: 1 },
    rationale: "test",
    expected: { status: "positive", labels: ["email_address"] },
    provenance: {
      proposed_by: "tester",
      proposed_at: "2026-08-31T00:00:00.000Z",
      review_state: "accepted",
    },
    ...overrides,
  };
}

describe("baseline gold stats collectors", () => {
  it("routes accepted component rows without resolvable concept leaf to migration accounting", () => {
    const record = annotation({
      id: "missing-leaf",
      layer: "components",
      subject: { key: "third_party:unknown-vendor" },
      expected: { status: "positive", labels: [] },
    });
    const { record: canonical, diagnostics } = loadCanonicalGoldFromAnnotation(record, {
      warn: () => undefined,
    });
    expect(["accepted", "migration_incomplete", "needs_adjudication"]).toContain(
      canonical.disposition,
    );
    expect(diagnostics).toEqual([]);
  });

  it("classifies data-flow accepted rows as awaiting adjudication", () => {
    const record = annotation({
      id: "flow-row",
      layer: "data_flows",
      subject: { key: "data_flow:api_to_db" },
      expected: { status: "positive", labels: ["flow"] },
    });
    const { record: canonical } = loadCanonicalGoldFromAnnotation(record, {
      warn: () => undefined,
    });
    expect(canonical.disposition).toBe("needs_adjudication");
  });

  it("aggregates review states from an isolated benchmark root", () => {
    const benchmarkRoot = path.join(__dirname, "../../benchmark");
    const counts = collectReviewStateCounts(benchmarkRoot);
    expect(counts.provenance).toBe("corpus-annotations");
    expect(counts.total.accepted).toBeGreaterThan(0);
  });

  it("aggregates migration incomplete accounting from corpus", () => {
    const benchmarkRoot = path.join(__dirname, "../../benchmark");
    const accounting = collectMigrationIncompleteAccounting(benchmarkRoot);
    expect(accounting.total).toBeGreaterThan(0);
    expect(Object.keys(accounting.byReason).length).toBeGreaterThan(0);
  });
});
