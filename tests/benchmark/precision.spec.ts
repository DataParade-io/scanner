import { scoreCorpusPrecision } from "./precision";
import type { AnnotationRecord } from "./schema";
import type { LayerFinding } from "../eval/types";

function annotation(
  id: string,
  layer: AnnotationRecord["layer"],
  key: string,
  filePath: string,
  startLine: number,
  endLine: number,
  extra: Partial<AnnotationRecord> = {},
): AnnotationRecord {
  return {
    id,
    layer,
    subject: { key },
    evidence: { file_path: filePath, start_line: startLine, end_line: endLine },
    rationale: "test",
    expected: { status: "positive", labels: [] },
    provenance: {
      proposed_by: "test",
      proposed_at: "2026-01-01T00:00:00Z",
      review_state: "accepted",
    },
    ...extra,
  };
}

function finding(
  key: string,
  filePath: string,
  startLine: number,
  endLine: number,
): LayerFinding {
  return {
    key,
    labels: [],
    sourceFilePaths: [filePath],
    sourceLines: [{ file_path: filePath, start_line: startLine, end_line: endLine }],
  };
}

describe("scoreCorpusPrecision", () => {
  it("returns null precision when no exhaustive scope is declared", () => {
    const report = scoreCorpusPrecision(
      [annotation("a", "components", "third_party:stripe", "app.py", 1, 1)],
      [finding("third_party:stripe", "app.py", 1, 1)],
    );
    expect(report.precision).toBeNull();
  });

  it("counts unmatched scanner findings in exhaustive files as false positives", () => {
    const report = scoreCorpusPrecision(
      [
        annotation("openai", "components", "third_party:openai", "app.py", 11, 11, {
          expected: { status: "positive", labels: [], exhaustive_scope_files: ["app.py"] },
        }),
      ],
      [
        finding("third_party:openai", "app.py", 11, 11),
        finding("third_party:stripe", "app.py", 11, 11),
      ],
    );
    expect(report.precision).toBe(0.5);
    expect(report.exhaustiveScopedFindings).toBe(2);
    expect(report.exhaustiveScopedMatches).toBe(1);
  });

  it("does not require a negative Stripe case to penalize extra Stripe hits", () => {
    const report = scoreCorpusPrecision(
      [
        annotation("openai", "data_flows", "flow:app->third_party:openai", "app.py", 11, 11, {
          expected: { status: "positive", labels: [], exhaustive_scope_files: ["app.py"] },
        }),
      ],
      [
        finding("flow:app->third_party:openai", "app.py", 11, 11),
        finding("flow:app->third_party:stripe", "app.py", 11, 11),
      ],
    );
    expect(report.precision).toBe(0.5);
  });

  it("matches data_items by identity only", () => {
    const report = scoreCorpusPrecision(
      [
        annotation("username", "data_items", "data_item:username", "app.yml", 6, 6, {
          expected: { status: "positive", labels: [], exhaustive_scope_files: ["app.yml"] },
        }),
      ],
      [
        finding("data_item:username", "app.yml", 1, 1),
        finding("data_item:password", "app.yml", 7, 7),
      ],
    );
    expect(report.precision).toBe(0.5);
  });

  it("excludes locationless synthetic findings from the denominator", () => {
    const report = scoreCorpusPrecision(
      [
        annotation("db", "components", "asset:pg", "db.ts", 1, 1, {
          expected: { status: "positive", labels: [], exhaustive_scope_files: ["db.ts"] },
        }),
      ],
      [
        finding("asset:pg", "db.ts", 1, 1),
        { key: "actor:user", labels: [], sourceFilePaths: [], sourceLines: [] },
      ],
    );
    expect(report.precision).toBe(1);
    expect(report.exhaustiveScopedFindings).toBe(1);
  });
});
