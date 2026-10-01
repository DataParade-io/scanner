import type { CommentContext } from "../../pii-signals/comment-context";
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

export interface ScanOccurrence {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  code?: string;
  labels: string[];
  /** `comment` when the match sits only in a comment or docstring (kept as context). */
  location?: "code" | "comment";
  /** Comments immediately around a code match. */
  commentContext?: CommentContext;
  /** Data item group, e.g. `email:customer`, when the scanner can tell. */
  group?: string;
}

export interface ScanDataItemGroup {
  /** Group id, e.g. `email:customer`. */
  id: string;
  occurrenceIds: string[];
}

export interface ScanDataItem {
  id: string;
  occurrenceIds: string[];
  labels: string[];
  /**
   * The separate data items found under this concept, such as a member's email
   * and a staff user's email (KDATAP-c8a46a). Occurrences without a group are only
   * listed in `occurrenceIds`.
   */
  groups?: ScanDataItemGroup[];
}

export interface OrchestratorScanResult {
  scanResult: ScanResult;
  files: FileInfo[];
  findings: RawFinding[];
  occurrences: ScanOccurrence[];
  dataItems: ScanDataItem[];
  ledgerContext?: OrchestratorLedgerContext;
  /** graphify's code-structure graph for this scan, when it ran (KDATAP-49ff82). */
  structureGraph?: import("../../structure/graphify").StructureGraphInfo;
}
