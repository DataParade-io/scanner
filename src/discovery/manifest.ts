import crypto from "crypto";

import { ONTOLOGY_SHA, ONTOLOGY_VERSION } from "./ontology-pin";

let cachedDigest: string | undefined;

/** Stable digest of discovery export adapter + ontology pin. */
export function resolveDiscoveryAdapterVersion(): string {
  if (cachedDigest) {
    return cachedDigest;
  }

  const payload = JSON.stringify({
    adapter: "scan-discovery-export",
    surface: "a0-data-flow",
    ontologyVersion: ONTOLOGY_VERSION,
    ontologySha: ONTOLOGY_SHA,
  });

  const hash = crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
  cachedDigest = `sha256:${hash}`;
  return cachedDigest;
}

export function clearDiscoveryAdapterVersionCacheForTest(): void {
  cachedDigest = undefined;
}
