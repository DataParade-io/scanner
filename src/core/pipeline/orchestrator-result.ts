import type { FileInfo, LanguageParserStats, RawFinding, ScanResult } from "../types";
import type { PathEligibilityOutcome } from "../../ingest/eligibility";
import type { ScanConfiguration } from "../types/config";

export interface OrchestratorLedgerContext {
  ingestOutcomes: PathEligibilityOutcome[];
  allIngestedFiles: FileInfo[];
  processedFiles: FileInfo[];
  languageStats: LanguageParserStats[];
  config: ScanConfiguration;
}

export interface ScanMention {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  code?: string;
  labels: string[];
}

export interface ScanDataItem {
  id: string;
  mentionIds: string[];
  labels: string[];
}

export interface OrchestratorScanResult {
  scanResult: ScanResult;
  files: FileInfo[];
  findings: RawFinding[];
  mentions: ScanMention[];
  dataItems: ScanDataItem[];
  ledgerContext?: OrchestratorLedgerContext;
}
