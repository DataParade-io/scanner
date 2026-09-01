import { createDefaultScanConfiguration } from "../../../src/core/pipeline/orchestrator";
import type { ScanConfiguration } from "../../../src/core/types/config";
import { digestStableJson } from "./digests";
import type { DeterministicScanConfig } from "./types";

const SECRET_CONFIG_KEYS = new Set<keyof ScanConfiguration>([
  "aiApiKey",
  "workspaceApiKey",
  "anonSessionToken",
]);

/** Eval baseline scan configuration — AI inference must be disabled. */
export function buildDeterministicScanConfig(): DeterministicScanConfig {
  const config = createDefaultScanConfiguration({ enableAiInference: false });
  if (config.enableAiInference !== false) {
    throw new Error("Baseline deterministic configuration requires enableAiInference: false");
  }

  return {
    enableAiInference: false,
    enableAPIDetection: config.enableAPIDetection,
    enableDatabaseDetection: config.enableDatabaseDetection,
    enableDataFlowDetection: config.enableDataFlowDetection,
    minimumConfidence: config.minimumConfidence,
    deepAnalysis: config.deepAnalysis ?? false,
    languages: config.languages ? [...config.languages].sort() : null,
    excludePaths: [...(config.excludePaths ?? [])].sort(),
  };
}

export function digestDeterministicScanConfig(config: DeterministicScanConfig): string {
  return digestStableJson(config);
}

export function sanitizeConfigForFingerprint(
  config: ScanConfiguration,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_CONFIG_KEYS.has(key as keyof ScanConfiguration)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}
