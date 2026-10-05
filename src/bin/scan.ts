#!/usr/bin/env node
/**
 * Scan a repository from a source checkout and write the full result as JSON.
 *
 *   pnpm scan <repo> [--out <file>]      (default: ./dataparade-scan.json)
 *
 * Runs locally: no account, API key or network access. Prints a short summary of
 * the components, data flows, and personal-data occurrences and data items found.
 */
import fs from "fs";
import path from "path";

import { createDefaultScanConfiguration, scan } from "../core/pipeline/orchestrator";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const out = path.resolve(outIndex >= 0 ? (args[outIndex + 1] ?? "") : "dataparade-scan.json");
  const root = args.find((arg, index) => !arg.startsWith("-") && !(outIndex >= 0 && index === outIndex + 1));
  if (!root || args.includes("--help") || args.includes("-h")) {
    console.error("Usage: pnpm scan <repo> [--out <file>]");
    process.exit(root ? 0 : 1);
  }
  const repo = path.resolve(root);
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) {
    console.error(`Not a directory: ${repo}`);
    process.exit(1);
  }

  const started = Date.now();
  let phase = "";
  const result = await scan(repo, createDefaultScanConfiguration({ enableAiInference: false }), (progress) => {
    if (progress?.phase && progress.phase !== phase) {
      phase = progress.phase;
      console.error(`  ${phase}...`);
    }
  });
  fs.writeFileSync(out, JSON.stringify(result, null, 2));

  const { scanResult, occurrences, dataItems } = result;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`Scanned ${repo} in ${seconds}s`);
  console.log(`  components: ${scanResult.components.length}`);
  console.log(`  data flows: ${scanResult.dataFlows.length}`);
  console.log(`  personal-data occurrences: ${occurrences.length}`);
  for (const item of dataItems) {
    const groups = item.groups?.length ? `, ${item.groups.length} groups` : "";
    console.log(`    ${item.id}: ${item.occurrenceIds.length} occurrences${groups}`);
  }
  for (const warning of scanResult.warnings ?? []) console.error(`warning: ${warning}`);
  console.log(`Wrote ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
