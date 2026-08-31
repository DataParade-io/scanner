import { scoreCorpusPrecision } from "./precision";
import type { AnnotationRecord, BenchmarkLayer, LayerScopeRecord, ReviewState } from "./schema";
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
  layer?: LayerFinding["layer"],
): LayerFinding {
  return {
    key,
    labels: [],
    ...(layer !== undefined ? { layer } : {}),
    sourceFilePaths: [filePath],
    sourceLines: [{ file_path: filePath, start_line: startLine, end_line: endLine }],
  };
}

function scopeProvenance(reviewState: ReviewState = "accepted") {
  return {
    proposed_by: "test",
    proposed_at: "2026-01-01T00:00:00Z",
    review_state: reviewState,
  };
}

function layerScopes(
  entries: Partial<Record<BenchmarkLayer, string[]>>,
  reviewState: ReviewState = "accepted",
): Map<BenchmarkLayer, LayerScopeRecord> {
  const scopes = new Map<BenchmarkLayer, LayerScopeRecord>();
  for (const [layer, files] of Object.entries(entries)) {
    if (!files || files.length === 0) {
      continue;
    }
    scopes.set(layer as BenchmarkLayer, {
      exhaustive_scope_files: files,
      provenance: scopeProvenance(reviewState),
    });
  }
  return scopes;
}

describe("scoreCorpusPrecision", () => {
  it("returns null precision when no exhaustive scope is declared", () => {
    const report = scoreCorpusPrecision(
      [annotation("a", "components", "third_party:stripe", "app.py", 1, 1)],
      [finding("third_party:stripe", "app.py", 1, 1)],
      new Map(),
    );
    expect(report.precision).toBeNull();
  });

  it("counts unmatched scanner findings in exhaustive files as false positives", () => {
    const report = scoreCorpusPrecision(
      [annotation("openai", "components", "third_party:openai", "app.py", 11, 11)],
      [
        finding("third_party:openai", "app.py", 11, 11),
        finding("third_party:stripe", "app.py", 11, 11),
      ],
      layerScopes({ components: ["app.py"] }),
    );
    expect(report.precision).toBe(0.5);
    expect(report.exhaustiveScopedFindings).toBe(2);
    expect(report.exhaustiveScopedMatches).toBe(1);
  });

  it("does not require a negative Stripe case to penalize extra Stripe hits", () => {
    const report = scoreCorpusPrecision(
      [annotation("openai", "data_flows", "flow:app->third_party:openai", "app.py", 11, 11)],
      [
        finding("flow:app->third_party:openai", "app.py", 11, 11),
        finding("flow:app->third_party:stripe", "app.py", 11, 11),
      ],
      layerScopes({ data_flows: ["app.py"] }),
    );
    expect(report.precision).toBe(0.5);
  });

  it("matches data_items by identity only", () => {
    const report = scoreCorpusPrecision(
      [annotation("username", "data_items", "data_item:username", "app.yml", 6, 6)],
      [
        finding("data_item:username", "app.yml", 1, 1),
        finding("data_item:password", "app.yml", 7, 7),
      ],
      layerScopes({ data_items: ["app.yml"] }),
    );
    expect(report.precision).toBe(0.5);
  });

  it("excludes locationless synthetic findings from the denominator", () => {
    const report = scoreCorpusPrecision(
      [annotation("db", "components", "asset:pg", "db.ts", 1, 1)],
      [
        finding("asset:pg", "db.ts", 1, 1),
        { key: "actor:user", labels: [], sourceFilePaths: [], sourceLines: [] },
      ],
      layerScopes({ components: ["db.ts"] }),
    );
    expect(report.precision).toBe(1);
    expect(report.exhaustiveScopedFindings).toBe(1);
  });

  it("does not count mentions findings inside a components exhaustive scope", () => {
    const report = scoreCorpusPrecision(
      [annotation("db", "components", "asset:pg", "app.py", 1, 1)],
      [
        finding("asset:pg", "app.py", 1, 1, "components"),
        finding("mention:email", "app.py", 2, 2, "mentions"),
      ],
      layerScopes({ components: ["app.py"] }),
    );
    expect(report.precision).toBe(1);
    expect(report.exhaustiveScopedFindings).toBe(1);
    expect(report.exhaustiveScopedMatches).toBe(1);
  });

  it("scores mentions findings inside a mentions exhaustive scope", () => {
    const report = scoreCorpusPrecision(
      [annotation("email", "mentions", "mention:email", "app.py", 2, 2)],
      [
        finding("mention:email", "app.py", 2, 2, "mentions"),
        finding("mention:phone", "app.py", 3, 3, "mentions"),
      ],
      layerScopes({ mentions: ["app.py"] }),
    );
    expect(report.precision).toBe(0.5);
    expect(report.exhaustiveScopedFindings).toBe(2);
    expect(report.exhaustiveScopedMatches).toBe(1);
  });

  it("scores mentions findings from a pii_signals layer scope bucket", () => {
    const scopes = new Map<BenchmarkLayer, LayerScopeRecord>([
      [
        "mentions",
        {
          exhaustive_scope_files: ["app.py"],
          provenance: scopeProvenance(),
        },
      ],
    ]);
    const report = scoreCorpusPrecision(
      [annotation("email", "pii_signals", "mention:email", "app.py", 2, 2)],
      [
        finding("mention:email", "app.py", 2, 2, "mentions"),
        finding("mention:phone", "app.py", 3, 3, "mentions"),
      ],
      scopes,
    );
    expect(report.precision).toBe(0.5);
    expect(report.exhaustiveScopedFindings).toBe(2);
    expect(report.exhaustiveScopedMatches).toBe(1);
  });

  it("merges pii_signals and mentions into one exhaustive scope bucket", () => {
    const report = scoreCorpusPrecision(
      [
        annotation("email", "mentions", "mention:email", "app.py", 2, 2),
        annotation("phone", "pii_signals", "mention:phone", "app.py", 3, 3),
      ],
      [finding("mention:email", "app.py", 2, 2, "mentions")],
      layerScopes({ mentions: ["app.py"] }),
    );
    expect(report.precision).toBe(1);
    expect(report.exhaustiveScopedFindings).toBe(1);
    expect(report.exhaustiveScopedMatches).toBe(1);
  });

  it("ignores proposed layer scopes for precision", () => {
    const report = scoreCorpusPrecision(
      [annotation("db", "components", "asset:pg", "db.ts", 1, 1)],
      [finding("asset:pg", "db.ts", 1, 1)],
      layerScopes({ components: ["db.ts"] }, "proposed"),
    );
    expect(report.precision).toBeNull();
    expect(report.exhaustiveScopedFindings).toBe(0);
  });

  it("flags extra-layer findings when a layer has scope but no positives", () => {
    const report = scoreCorpusPrecision(
      [],
      [finding("asset:phantom", "app.py", 1, 1, "components")],
      layerScopes({ components: ["app.py"] }),
    );
    expect(report.precision).toBe(0);
    expect(report.exhaustiveScopedFindings).toBe(1);
    expect(report.exhaustiveScopedMatches).toBe(0);
  });
});
