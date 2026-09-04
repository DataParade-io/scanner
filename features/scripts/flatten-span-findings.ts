#!/usr/bin/env node
/**
 * Emit span-level findings for Plexus SubjectSpanOverlapScore evaluation.
 *
 * SubjectSpanOverlapScore expects filePath, startLine, and endLine on each
 * finding. scan-layer-findings nests those fields under evidenceLocations;
 * this script flattens one row per evidence span.
 *
 * Usage:
 *   node -r ts-node/register features/scripts/flatten-span-findings.ts \
 *     --root <dir> --layer raw-hits|mentions|data-items
 */

import { parseArgs } from "node:util";

import {
  collectPersonalDataFindings,
  type PersonalDataEvalLayer,
  type PersonalDataFinding,
  type PersonalDataFindingsPayload,
} from "../../src/eval-layers/collect-personal-data-findings";

const LAYER_ALIASES: Record<string, PersonalDataEvalLayer> = {
  "raw-hits": "raw-hits",
  mentions: "mentions",
  "data-items": "data-items",
};

interface SpanFinding {
  subjectKey: string;
  labels: string[];
  filePath: string;
  startLine: number;
  endLine: number;
}

function parseLayer(value: string | undefined): PersonalDataEvalLayer {
  const layer = value?.trim();
  if (!layer || !(layer in LAYER_ALIASES)) {
    throw new Error(
      "--layer is required and must be one of: raw-hits, mentions, data-items",
    );
  }
  return LAYER_ALIASES[layer];
}

function flattenFindings(findings: PersonalDataFinding[]): SpanFinding[] {
  const flattened: SpanFinding[] = [];

  for (const finding of findings) {
    for (const location of finding.evidenceLocations) {
      flattened.push({
        subjectKey: finding.subjectKey,
        labels: [...finding.labels],
        filePath: location.filePath,
        startLine: location.startLine,
        endLine: location.endLine,
      });
    }
  }

  flattened.sort((left, right) => {
    const fileCmp = left.filePath.localeCompare(right.filePath);
    if (fileCmp !== 0) {
      return fileCmp;
    }
    if (left.startLine !== right.startLine) {
      return left.startLine - right.startLine;
    }
    if (left.endLine !== right.endLine) {
      return left.endLine - right.endLine;
    }
    return left.subjectKey.localeCompare(right.subjectKey);
  });

  return flattened;
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

  const output = {
    findings: flattenFindings(payload.findings),
    filesScanned: payload.filesScanned,
  };

  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}

export { flattenFindings, main };
