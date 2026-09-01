import crypto from "crypto";

import { createDefaultScanConfiguration } from "../../../core/pipeline/orchestrator";
import { loadPiiSignalRules } from "../../../pii-signals/pii-signal-rules";

let cachedDigest: string | undefined;

/** Stable digest of eval scan configuration and enabled personal-data rules. */
export function resolveScannerAdapterMapVersion(): string {
  if (cachedDigest) {
    return cachedDigest;
  }

  const config = createDefaultScanConfiguration({ enableAiInference: false });
  const ruleIds = loadPiiSignalRules()
    .map((rule) => rule.id)
    .sort();

  const payload = JSON.stringify({
    enableAiInference: config.enableAiInference,
    ruleIds,
  });

  const hash = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
  cachedDigest = `sha256:${hash}`;
  return cachedDigest;
}

export function clearScannerAdapterMapVersionCacheForTest(): void {
  cachedDigest = undefined;
}
