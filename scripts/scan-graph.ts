#!/usr/bin/env node
/**
 * Scan a repository and write the combined knowledge graph (KDATAP-a528cd):
 * graphify's code-structure graph and DataParade's privacy/security layer.
 *
 *   npx ts-node --transpile-only scripts/scan-graph.ts --root <repo> --out <dir> [--graphify <command>]
 *
 * Writes <dir>/graphify-out/graph.json and <dir>/dataparade-graph.json.
 */
import path from "path";

import { createDefaultScanConfiguration, scan } from "../src/core/pipeline/orchestrator";
import { writeKnowledgeGraph } from "../src/graph/build-dataparade-graph";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const root = arg("root");
  const out = arg("out");
  if (!root || !out) {
    console.error("Usage: scan-graph --root <repo> --out <dir> [--graphify <command>]");
    process.exit(1);
  }
  const outDir = path.resolve(out);
  const config = createDefaultScanConfiguration({
    enableAiInference: false,
    structureGraph: { enabled: true, outDir, ...(arg("graphify") ? { command: arg("graphify") } : {}) },
  });
  const result = await scan(path.resolve(root), config);
  for (const warning of result.scanResult.warnings) {
    if (/structure graph|graphify/.test(warning)) console.error(`warning: ${warning}`);
  }
  const written = await writeKnowledgeGraph(result, outDir);
  console.log(JSON.stringify({ ...written, structure: result.structureGraph ?? null }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
