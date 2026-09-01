import type { MaterializedSourceFingerprint } from "./baseline/types";
import { collectMaterializedSources } from "./baseline/collect-materializations";
import { resolveDefaultBenchmarkRoot } from "./paths";

export interface MaterializationValidationFailure {
  repoKey: string;
  validationStatus: MaterializedSourceFingerprint["validationStatus"];
  reason?: string;
  manifestCommit: string;
  validatedHeadSha: string | null;
}

export interface MaterializationValidationReport {
  benchmarkRoot: string;
  totalPackets: number;
  validCount: number;
  failures: MaterializationValidationFailure[];
  entries: MaterializedSourceFingerprint[];
}

export function evaluateMaterializationEntry(
  entry: MaterializedSourceFingerprint,
): MaterializationValidationFailure | null {
  if (entry.validationStatus !== "valid") {
    return {
      repoKey: entry.repoKey,
      validationStatus: entry.validationStatus,
      reason: entry.reason,
      manifestCommit: entry.manifestCommit,
      validatedHeadSha: entry.validatedHeadSha,
    };
  }

  if (entry.validatedHeadSha !== entry.manifestCommit) {
    return {
      repoKey: entry.repoKey,
      validationStatus: "invalid",
      reason: `validated head ${entry.validatedHeadSha} does not match manifest commit ${entry.manifestCommit}`,
      manifestCommit: entry.manifestCommit,
      validatedHeadSha: entry.validatedHeadSha,
    };
  }

  return null;
}

export function buildMaterializationValidationReport(
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): MaterializationValidationReport {
  const entries = collectMaterializedSources(benchmarkRoot);
  const failures = entries
    .map((entry) => evaluateMaterializationEntry(entry))
    .filter((failure): failure is MaterializationValidationFailure => failure !== null);

  return {
    benchmarkRoot,
    totalPackets: entries.length,
    validCount: entries.length - failures.length,
    failures,
    entries,
  };
}

export function isMaterializationValidationPassing(
  report: MaterializationValidationReport,
): boolean {
  return report.failures.length === 0 && report.totalPackets > 0;
}
