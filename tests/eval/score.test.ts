import { scoreEvalCases } from "./score";
import type { EvalCase, FixtureScanResult } from "./types";

describe("eval/score", () => {
  const positiveCase: EvalCase = {
    id: "positive-1",
    fixture: "fixture-a",
    layer: "mentions",
    subject: { key: "mention:email" },
    evidence: { file_path: "app.py", start_line: 10, end_line: 10 },
    expected: { status: "positive", labels: ["email"] },
    rationale: "test",
  };

  const scanResult: FixtureScanResult = {
    fixture: "fixture-a",
    scannedFiles: ["app.py"],
    findings: [
      {
        key: "mention:email",
        labels: ["email"],
        sourceFilePaths: ["app.py"],
        sourceLines: [
          { file_path: "app.py", start_line: 10, end_line: 10 },
        ],
      },
    ],
  };

  it("counts a matching positive as recall", () => {
    const report = scoreEvalCases([positiveCase], [scanResult]);
    expect(report.scores.recall).toBe(1);
    expect(report.caseResults[0]?.matched).toBe(true);
  });

  it("matches data-items by identity only", () => {
    const dataItemCase: EvalCase = {
      ...positiveCase,
      id: "data-item-1",
      layer: "data-items",
      subject: { key: "data_item:email" },
      evidence: { file_path: "other.py", start_line: 1, end_line: 1 },
    };
    const dataItemScan: FixtureScanResult = {
      fixture: "fixture-a",
      scannedFiles: ["app.py"],
      findings: [
        {
          key: "data_item:email",
          labels: ["email"],
          sourceFilePaths: ["app.py"],
          sourceLines: [
            { file_path: "app.py", start_line: 99, end_line: 99 },
          ],
        },
      ],
    };

    const report = scoreEvalCases([dataItemCase], [dataItemScan]);
    expect(report.caseResults[0]?.matched).toBe(true);
  });

  it("omits unread positives from recall denominator", () => {
    const unreadCase: EvalCase = {
      ...positiveCase,
      evidence: { file_path: "missing.py", start_line: 1, end_line: 1 },
    };
    const report = scoreEvalCases([unreadCase], [scanResult]);
    expect(report.scores.recall).toBeNull();
    expect(report.scores.unreadCount).toBe(1);
    expect(report.caseResults[0]?.unread).toBe(true);
  });
});
