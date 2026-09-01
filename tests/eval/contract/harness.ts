import { scoreEvalCases } from "../score";
import type { EvalCase, EvalLayer, FixtureScanResult, LayerFinding } from "../types";
import { layerOutcome, type EligibilityReason } from "../../../src/ingest/eligibility";
import { createLayerLedger } from "../eligibility/types";
import { evidenceEligibilityReason } from "../eligibility/ledger-access";
import type { ContractScenario, ContractScenarioExpect } from "./types";

export const CONTRACT_FIXTURE = "contract-fixture";

export function scanResult(
  findings: LayerFinding[],
  layer: EvalLayer,
  outcomes: Array<{ path: string; reason: EligibilityReason }> = [
    { path: "src/app.yml", reason: "successfully_processed" },
  ],
): FixtureScanResult {
  const ledger = createLayerLedger(
    layer,
    outcomes.map(({ path, reason }) => layerOutcome(path, reason)),
  );
  return {
    fixture: CONTRACT_FIXTURE,
    findings,
    scannedFiles: outcomes
      .filter((entry) => entry.reason === "successfully_processed")
      .map((entry) => entry.path),
    eligibilityLedgers: { [layer]: ledger },
  };
}

export function positiveCase(
  id: string,
  layer: EvalLayer,
  key: string,
  filePath: string,
  startLine: number,
  endLine: number,
  labels: string[],
  extra: Partial<EvalCase> = {},
): EvalCase {
  return {
    id,
    fixture: CONTRACT_FIXTURE,
    layer,
    subject: { key, name: key },
    evidence: { file_path: filePath, start_line: startLine, end_line: endLine },
    expected: { status: "positive", labels },
    rationale: extra.rationale ?? "contract synthetic positive",
    ...extra,
  };
}

export function negativeCase(
  id: string,
  layer: EvalLayer,
  key: string,
  filePath: string,
  startLine: number,
  endLine: number,
  extra: Partial<EvalCase> = {},
): EvalCase {
  return {
    id,
    fixture: CONTRACT_FIXTURE,
    layer,
    subject: { key, name: key },
    evidence: { file_path: filePath, start_line: startLine, end_line: endLine },
    expected: { status: "negative", labels: [] },
    rationale: "contract synthetic negative",
    ...extra,
  };
}

export function finding(
  key: string,
  filePath: string,
  startLine: number,
  endLine: number,
  labels: string[],
  layer?: EvalLayer,
): LayerFinding {
  return {
    key,
    labels,
    sourceFilePaths: [filePath],
    sourceLines: [{ file_path: filePath, start_line: startLine, end_line: endLine }],
    layer,
  };
}

export function runContractScenario(scenario: ContractScenario) {
  return scoreEvalCases(scenario.cases, scenario.scanResults);
}

export function assertContractExpect(
  report: ReturnType<typeof scoreEvalCases>,
  expected: ContractScenarioExpect,
  cases: EvalCase[],
  scanResults: FixtureScanResult[],
): void {
  const { denominators } = report.scores;

  if (expected.evaluablePositives !== undefined) {
    expect(denominators.evaluablePositives).toBe(expected.evaluablePositives);
  }
  if (expected.matchedPositives !== undefined) {
    expect(denominators.matchedPositives).toBe(expected.matchedPositives);
  }
  if (expected.matchedWithCorrectLabels !== undefined) {
    expect(denominators.matchedWithCorrectLabels).toBe(expected.matchedWithCorrectLabels);
  }
  if (expected.negativeCases !== undefined) {
    expect(denominators.negativeCases).toBe(expected.negativeCases);
  }
  if (expected.negativeCasesPassed !== undefined) {
    expect(denominators.negativeCasesPassed).toBe(expected.negativeCasesPassed);
  }
  if (expected.unreadCount !== undefined) {
    expect(report.scores.unreadCount).toBe(expected.unreadCount);
  }
  if (expected.recall !== undefined) {
    expect(report.scores.recall).toBe(expected.recall);
  }
  if (expected.labelAccuracy !== undefined) {
    expect(report.scores.labelAccuracy).toBe(expected.labelAccuracy);
  }
  if (expected.correctLabelRecall !== undefined) {
    expect(report.scores.correctLabelRecall).toBe(expected.correctLabelRecall);
  }
  if (expected.negativeCasePassRate !== undefined) {
    expect(report.scores.negativeCasePassRate).toBe(expected.negativeCasePassRate);
  }
  if (expected.precision !== undefined) {
    expect(report.scores.precision).toBe(expected.precision);
  }

  for (const check of expected.caseChecks ?? []) {
    const result = report.caseResults.find((entry) => entry.caseId === check.caseId);
    expect(result).toBeDefined();
    if (check.unread !== undefined) {
      expect(result!.unread).toBe(check.unread);
    }
    if (check.matched !== undefined) {
      expect(result!.matched).toBe(check.matched);
    }
    if (check.labelsCorrect !== undefined) {
      expect(result!.labelsCorrect).toBe(check.labelsCorrect);
    }
    if (check.negativeClean !== undefined) {
      expect(result!.negativeClean).toBe(check.negativeClean);
    }
    if (check.documentedGap !== undefined) {
      expect(result!.documentedGap).toBe(check.documentedGap);
    }
    if (check.eligibilityReason !== undefined) {
      const caseRecord = cases.find((entry) => entry.id === check.caseId)!;
      const scan = scanResults.find((entry) => entry.fixture === caseRecord.fixture);
      expect(evidenceEligibilityReason(caseRecord, scan)).toBe(check.eligibilityReason);
    }
  }
}
