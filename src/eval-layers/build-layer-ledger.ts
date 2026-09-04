import type { FileInfo } from "../core/types/file";
import type { LanguageParserStats } from "../core/types";
import type { ScanConfiguration } from "../core/types/config";
import { getAnalyzerForFile } from "../analyzers/registry";
import {
  isLanguageSupportedForEvalLayer,
  type EvalLayerId,
} from "./layer-capability";
import {
  ingestOutcome,
  layerOutcome,
  type PathEligibilityOutcome,
} from "../ingest/eligibility";

export interface OrchestratorLedgerInput {
  ingestOutcomes: PathEligibilityOutcome[];
  allIngestedFiles: FileInfo[];
  processedFiles: FileInfo[];
  config: ScanConfiguration;
  languageStats: LanguageParserStats[];
}

function patternToRegex(pattern: string): RegExp {
  let escaped = pattern.replace(/[-\\^$+?.()|[\]{}*?]/g, "\\$&");
  escaped = escaped.replace(/\\\*\\\*/g, ".*");
  escaped = escaped.replace(/\\\*/g, "[^/]*");
  escaped = escaped.replace(/\\\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

function parserErrorPaths(languageStats: LanguageParserStats[]): Set<string> {
  const paths = new Set<string>();
  for (const stats of languageStats) {
    for (const warning of stats.warnings) {
      const match = warning.match(/^[a-z-]+-parser \(([^)]+)\):/);
      if (match?.[1]) {
        paths.add(match[1]);
      }
    }
  }
  return paths;
}

function wasLanguageFiltered(
  file: FileInfo,
  config: ScanConfiguration,
): boolean {
  if (!config.languages || config.languages.length === 0) {
    return false;
  }
  return !config.languages.includes(file.language);
}

function wasExcludePathFiltered(
  file: FileInfo,
  config: ScanConfiguration,
): boolean {
  if (!config.excludePaths || config.excludePaths.length === 0) {
    return false;
  }
  const regexes = config.excludePaths.map((pattern) => patternToRegex(pattern));
  return regexes.some((regex) => regex.test(file.path));
}

/**
 * Build per-path layer-stage outcomes for orchestrator-backed eval layers.
 * Ingest success alone does not confer layer eligibility.
 */
export function buildOrchestratorLayerLedger(
  layer: EvalLayerId,
  input: OrchestratorLedgerInput,
): PathEligibilityOutcome[] {
  const processedPaths = new Set(input.processedFiles.map((file) => file.path));
  const ingestedByPath = new Map(
    input.allIngestedFiles.map((file) => [file.path, file]),
  );
  const parseErrors = parserErrorPaths(input.languageStats);
  const outcomes: PathEligibilityOutcome[] = [];

  for (const ingestEntry of input.ingestOutcomes) {
    if (ingestEntry.reason !== "successfully_processed") {
      continue;
    }
    const file = ingestedByPath.get(ingestEntry.path);
    if (!file) {
      continue;
    }

    let reason: PathEligibilityOutcome["reason"];
    if (wasLanguageFiltered(file, input.config)) {
      reason = "excluded_by_configured_policy";
    } else if (wasExcludePathFiltered(file, input.config)) {
      reason = "excluded_by_configured_policy";
    } else if (!processedPaths.has(file.path)) {
      reason = "excluded_by_configured_policy";
    } else if (!isLanguageSupportedForEvalLayer(layer, file.language)) {
      reason = "unsupported_file_type_or_language";
    } else if (parseErrors.has(file.path)) {
      reason = "parse_or_layer_processing_error";
    } else if (file.language !== "terraform" && !getAnalyzerForFile(file)) {
      reason = "unsupported_file_type_or_language";
    } else {
      reason = "successfully_processed";
    }

    outcomes.push(layerOutcome(file.path, reason));
  }

  return outcomes.sort((left, right) => left.path.localeCompare(right.path));
}

export function buildPersonalDataLayerLedger(
  layer: EvalLayerId,
  ingestOutcomes: PathEligibilityOutcome[],
  ingestedFiles: FileInfo[],
): PathEligibilityOutcome[] {
  const ingestedByPath = new Map(
    ingestedFiles.map((file) => [file.path, file]),
  );
  const outcomes: PathEligibilityOutcome[] = [];

  for (const ingestEntry of ingestOutcomes) {
    if (ingestEntry.reason !== "successfully_processed") {
      outcomes.push(layerOutcome(ingestEntry.path, ingestEntry.reason));
      continue;
    }

    const file = ingestedByPath.get(ingestEntry.path);
    if (!file) {
      continue;
    }

    const reason = isLanguageSupportedForEvalLayer(layer, file.language)
      ? "successfully_processed"
      : "unsupported_file_type_or_language";
    outcomes.push(layerOutcome(file.path, reason));
  }

  return outcomes.sort((left, right) => left.path.localeCompare(right.path));
}

export function missingPathOutcome(path: string): PathEligibilityOutcome {
  return layerOutcome(path, "missing_or_path_contract_mismatch");
}
