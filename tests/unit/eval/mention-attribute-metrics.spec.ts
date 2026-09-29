import { evaluateCanonical } from "../../eval/canonical/evaluate-fixture";
import type { EvalCase, FixtureScanResult, LayerFinding } from "../../eval/types";
import { layerOutcome } from "../../../src/ingest/eligibility";
import { createLayerLedger } from "../../eval/eligibility/types";
import {
  computeMentionAttributeMetrics,
  computePairwiseGrouping,
  declaredMentionAttributes,
  type MentionAttributeValues,
} from "../../../src/eval/canonical/mention-attribute-metrics";
import { mergeAttributeScores } from "../../benchmark/scorecard-vector";

const FIXTURE = "attribute-fixture";
const FILE = "src/signup.js";

function mentionCase(id: string, line: number, attributes?: MentionAttributeValues): EvalCase {
  return {
    id,
    fixture: FIXTURE,
    layer: "mentions",
    subject: { key: "mention:email", name: "email" },
    evidence: { file_path: FILE, start_line: line, end_line: line },
    expected: { status: "positive", labels: ["email"] },
    rationale: "synthetic mention",
    ...(attributes ? { mentionAttributes: attributes } : {}),
  };
}

function mentionFinding(line: number, attributes?: MentionAttributeValues): LayerFinding {
  return {
    key: "mention:email",
    labels: ["email"],
    sourceFilePaths: [FILE],
    sourceLines: [{ file_path: FILE, start_line: line, end_line: line }],
    layer: "mentions",
    ...(attributes ? { mentionAttributes: attributes } : {}),
  };
}

function scan(findings: LayerFinding[]): FixtureScanResult {
  return {
    fixture: FIXTURE,
    findings,
    scannedFiles: [FILE],
    eligibilityLedgers: {
      mentions: createLayerLedger("mentions", [layerOutcome(FILE, "successfully_processed")]),
    },
  };
}

const param = { file_path: FILE, line: 2, kind: "parameter" };

describe("computeMentionAttributeMetrics", () => {
  it("scores each attribute over matched pairs whose gold asserts it", () => {
    const scores = computeMentionAttributeMetrics(
      [
        { gold: { syntax_kind: "identifier", declaration: param }, finding: { syntax_kind: "identifier", declaration: param } },
        { gold: { syntax_kind: "identifier", declaration: "unresolved" }, finding: { syntax_kind: "property_key", declaration: param } },
        { gold: { owner: "api" }, finding: { syntax_kind: "identifier" } },
      ],
      new Set(["syntax_kind", "declaration"]),
    );
    expect(scores.syntax_kind).toEqual({ state: "computable", value: 0.5, numerator: 1, denominator: 2 });
    expect(scores.declaration).toEqual({ state: "computable", value: 0.5, numerator: 1, denominator: 2 });
    expect(scores.owner).toEqual({ state: "scanner_capability_not_declared", value: null, numerator: 0, denominator: 1 });
    expect(scores.type_annotation.state).toBe("not_asserted_by_gold");
  });

  it("compares touches as sets and declarations by file, line, and kind", () => {
    const scores = computeMentionAttributeMetrics(
      [
        { gold: { touches: ["b", "a"], declaration: param }, finding: { touches: ["a", "b"], declaration: { ...param, kind: "local" } } },
      ],
      new Set(["touches", "declaration"]),
    );
    expect(scores.touches.value).toBe(1);
    expect(scores.declaration.value).toBe(0);
  });

  it("finds declared attributes across all findings", () => {
    expect([...declaredMentionAttributes([undefined, { owner: "api" }, { syntax_kind: "comment" }])].sort()).toEqual([
      "owner",
      "syntax_kind",
    ]);
  });
});

describe("computePairwiseGrouping", () => {
  it("scores gold and predicted same-group pairs", () => {
    const scores = computePairwiseGrouping(
      [
        { goldGroup: "member", predictedGroup: "x" },
        { goldGroup: "member", predictedGroup: "x" },
        { goldGroup: "member", predictedGroup: "y" },
        { goldGroup: "staff", predictedGroup: "y" },
      ],
      true,
    );
    // gold pairs: 3 (member x3); predicted pairs: 2 (x-x, y-y); both: 1
    expect(scores.recall).toEqual({ state: "computable", value: 1 / 3, numerator: 1, denominator: 3 });
    expect(scores.precision).toEqual({ state: "computable", value: 0.5, numerator: 1, denominator: 2 });
  });

  it("reports an undeclared scanner capability instead of zero", () => {
    const scores = computePairwiseGrouping([{ goldGroup: "a" }, { goldGroup: "a" }], false);
    expect(scores.recall.state).toBe("scanner_capability_not_declared");
    expect(scores.recall.denominator).toBe(1);
  });
});

describe("evaluateCanonical mention attributes", () => {
  it("scores attributes and grouping over matched mention pairs", () => {
    const cases = [
      mentionCase("m1", 2, { syntax_kind: "identifier", declaration: param, group: "g1" }),
      mentionCase("m2", 4, { syntax_kind: "identifier", declaration: param, group: "g1" }),
    ];
    const findings = [
      mentionFinding(2, { syntax_kind: "identifier", declaration: param, group: "s1" }),
      mentionFinding(4, { syntax_kind: "property_key", declaration: param, group: "s1" }),
    ];
    const report = evaluateCanonical(cases, [scan(findings)]);
    expect(report.scores.denominators.matchedPositives).toBe(2);
    expect(report.scores.mentionAttributes?.syntax_kind).toEqual({
      state: "computable",
      value: 0.5,
      numerator: 1,
      denominator: 2,
    });
    expect(report.scores.mentionAttributes?.declaration.value).toBe(1);
    expect(report.scores.grouping?.recall.value).toBe(1);
    expect(report.scores.grouping?.precision.value).toBe(1);
  });

  it("does not change headline recall when the scanner emits no attributes", () => {
    const cases = [mentionCase("m1", 2, { syntax_kind: "identifier", group: "g1" })];
    const report = evaluateCanonical(cases, [scan([mentionFinding(2)])]);
    expect(report.scores.recall).toBe(1);
    expect(report.scores.mentionAttributes?.syntax_kind.state).toBe("scanner_capability_not_declared");
    expect(report.scores.grouping?.recall.state).toBe("scanner_capability_not_declared");
  });

  it("leaves other layers without attribute metrics", () => {
    const report = evaluateCanonical(
      [{ ...mentionCase("d1", 2), layer: "data-items", subject: { key: "data_item:email" } }],
      [scan([])],
    );
    expect(report.scores.mentionAttributes).toBeUndefined();
  });
});

describe("mergeAttributeScores", () => {
  it("sums computable packets and keeps the undeclared state otherwise", () => {
    expect(
      mergeAttributeScores([
        { state: "computable", value: 1, numerator: 2, denominator: 2 },
        { state: "computable", value: 0, numerator: 0, denominator: 2 },
      ]),
    ).toEqual({ state: "computable", value: 0.5, numerator: 2, denominator: 4 });
    expect(
      mergeAttributeScores([
        { state: "scanner_capability_not_declared", value: null, numerator: 0, denominator: 3 },
        { state: "not_asserted_by_gold", value: null, numerator: 0, denominator: 0 },
      ]).state,
    ).toBe("scanner_capability_not_declared");
  });
});
