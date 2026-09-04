import type { EvalCase, EvalScoreReport, FixtureScanResult } from "../types";
import type { EligibilityReason } from "../../../src/ingest/eligibility";

export interface ContractCaseCheck {
  caseId: string;
  unread?: boolean;
  matched?: boolean;
  labelsCorrect?: boolean;
  negativeClean?: boolean;
  documentedGap?: boolean;
  eligibilityReason?: EligibilityReason;
}

export interface ContractScenarioExpect {
  evaluablePositives?: number;
  matchedPositives?: number;
  matchedWithCorrectLabels?: number;
  negativeCases?: number;
  negativeCasesPassed?: number;
  unreadCount?: number;
  recall?: number | null;
  labelAccuracy?: number | null;
  correctLabelRecall?: number | null;
  negativeCasePassRate?: number | null;
  precision?: number | null;
  caseChecks?: ContractCaseCheck[];
}

export interface ContractScenario {
  name: string;
  cases: EvalCase[];
  scanResults: FixtureScanResult[];
  expect: ContractScenarioExpect;
}

export type ContractScenarioRunner = (scenario: ContractScenario) => EvalScoreReport;
