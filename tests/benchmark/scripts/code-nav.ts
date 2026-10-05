#!/usr/bin/env node
/**
 * Code navigator over the tree-sitter engine (KDATAP-059e1e): indexes a repository once,
 * then answers JSON-lines requests on stdin with one JSON response per line on stdout.
 *
 *   node dist/tests/benchmark/scripts/code-nav.js <repo-root>
 *   echo '{"op":"callers","name":"send_fulfillment_update_email_task"}' | node dist/tests/benchmark/scripts/code-nav.js <repo-root>
 *
 * Ops: outline, symbols, definition, callers, writers (see src/analyze/code-navigator.ts).
 * Progress goes to stderr. Not invoked by CI or pnpm test.
 */
import path from "path";
import readline from "readline";

import { CodeNavigator, type NavRequest } from "../../../src/analyze/code-navigator";
import { initAnalysisEngine } from "../../../src/analyze/engine/engine";
import { LANGUAGE_PACKS } from "../../../src/analyze/languages";
import { ingestFileSystem } from "../../../src/ingest/file-system";
import { readSchemaFiles } from "../../../src/ingest/schema-files";

async function main(): Promise<void> {
  const root = process.argv[2];
  if (!root) {
    console.error("Usage: node dist/tests/benchmark/scripts/code-nav.js <repo-root>");
    process.exit(2);
  }
  const started = Date.now();
  await initAnalysisEngine(LANGUAGE_PACKS);
  const files = await ingestFileSystem(path.resolve(root));
  const navigator = new CodeNavigator(files, await readSchemaFiles(path.resolve(root)));
  console.error(`indexed ${navigator.fileCount} files in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const text of lines) {
    if (!text.trim()) continue;
    let response;
    try {
      response = navigator.handle(JSON.parse(text) as NavRequest);
    } catch {
      response = { ok: false, error: "request is not valid JSON" };
    }
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
