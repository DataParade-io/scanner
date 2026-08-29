#!/usr/bin/env node
/**
 * Emit personal-data layer findings as JSON for Plexus SubjectIdentityScore evaluation.
 *
 * Usage:
 *   npx ts-node scripts/scan-layer-findings.ts --root <dir> --layer raw-hits|mentions|data-items
 */

import { parseArgs } from "node:util";

import {
  collectPersonalDataFindings,
  type PersonalDataEvalLayer,
  type PersonalDataFindingsPayload,
} from "../src/eval-layers/collect-personal-data-findings";

const LAYER_ALIASES: Record<string, PersonalDataEvalLayer> = {
  "raw-hits": "raw-hits",
  mentions: "mentions",
  "data-items": "data-items",
};

function parseLayer(value: string | undefined): PersonalDataEvalLayer {
  const layer = value?.trim();
  if (!layer || !(layer in LAYER_ALIASES)) {
    throw new Error(
      "--layer is required and must be one of: raw-hits, mentions, data-items",
    );
  }
  return LAYER_ALIASES[layer];
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      layer: { type: "string" },
    },
  });

  const rootPath = values.root?.trim();
  if (!rootPath) {
    throw new Error("--root is required");
  }

  const layer = parseLayer(values.layer);
  const payload: PersonalDataFindingsPayload = await collectPersonalDataFindings(
    rootPath,
    layer,
  );

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

export { main };
