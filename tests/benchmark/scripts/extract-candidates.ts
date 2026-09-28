#!/usr/bin/env node
/**
 * Extract candidate lines for labeling from source code only.
 *
 * Usage:
 *   node dist/tests/benchmark/scripts/extract-candidates.js <repo-key> <concept> [file1 file2 ...]
 *   node dist/tests/benchmark/scripts/extract-candidates.js ghost email
 *   node dist/tests/benchmark/scripts/extract-candidates.js saleor email saleor/account/models.py
 *
 * Output: tests/benchmark/repos/<repo-key>/annotations/packets/<concept>-candidates.yaml
 * Also prints per-file count summary to stdout.
 */

import fs from "fs";
import path from "path";
import YAML from "yaml";

import { resolveDefaultBenchmarkRoot } from "../paths";
import {
  extractCandidates,
  listScopeFiles,
  printSummary,
  type CandidatesOutput,
} from "../candidate-inventory";

function usage(): void {
  console.error(
    "Usage: node dist/tests/benchmark/scripts/extract-candidates.js <repo-key> <concept> [file1 file2 ...]",
  );
  console.error("Example: pnpm run benchmark:candidates ghost email");
  console.error("Example: pnpm run benchmark:candidates saleor email saleor/account/models.py");
  process.exit(1);
}

function loadTokens(
  tokensPath: string,
  concept: string,
): string[] {
  if (!fs.existsSync(tokensPath)) {
    throw new Error(`Missing tokens config at ${tokensPath}`);
  }
  const content = fs.readFileSync(tokensPath, "utf8");
  const parsed = YAML.parse(content) as Record<string, unknown>;

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid tokens YAML at ${tokensPath}`);
  }

  const conceptTokens = parsed[concept];
  if (!Array.isArray(conceptTokens)) {
    throw new Error(
      `Concept '${concept}' not found in ${tokensPath} or not an array`,
    );
  }

  return conceptTokens.map((token) => String(token));
}

function loadManifest(manifestPath: string): Record<string, unknown> {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing manifest at ${manifestPath}`);
  }
  const content = fs.readFileSync(manifestPath, "utf8");
  const parsed = YAML.parse(content) as Record<string, unknown>;

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid manifest YAML at ${manifestPath}`);
  }

  return parsed;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.length < 2) {
    usage();
  }

  const repoKey = args[0];
  const concept = args[1];
  const providedFiles = args.length > 2 ? args.slice(2) : undefined;

  const benchmarkRoot = resolveDefaultBenchmarkRoot(__dirname);
  const reposRoot = path.join(benchmarkRoot, "repos");
  const tokensPath = path.join(benchmarkRoot, "scripts", "candidate-tokens.yaml");
  const metadataDir = path.join(reposRoot, repoKey);
  const manifestPath = path.join(metadataDir, "manifest.yaml");

  if (!fs.existsSync(metadataDir)) {
    throw new Error(`Unknown repo key '${repoKey}'. Path not found: ${metadataDir}`);
  }

  // Load manifest and resolve the materialized repo path
  const manifest = loadManifest(manifestPath);
  const commit = String(manifest.commit ?? "");
  const cacheRoot = path.join(benchmarkRoot, ".cache", "repos");
  const materializedRepoPath = path.join(cacheRoot, `${repoKey}@${commit}`);

  if (!fs.existsSync(materializedRepoPath)) {
    throw new Error(
      `Materialized repo not found at ${materializedRepoPath}. ` +
        `Run: pnpm run benchmark:materialize ${repoKey}`,
    );
  }

  const tokens = loadTokens(tokensPath, concept);
  const scope = manifest.scope as { include?: unknown } | undefined;
  const include = Array.isArray(scope?.include)
    ? scope.include.map((entry) => String(entry))
    : [];

  // Get files to scan
  const files = providedFiles && providedFiles.length > 0
    ? providedFiles
    : listScopeFiles(include, materializedRepoPath);

  const candidates = extractCandidates(tokens, materializedRepoPath, files);

  // Create output directory
  const outputDir = path.join(metadataDir, "annotations", "packets");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, `${concept}-candidates.yaml`);
  const output: CandidatesOutput = { candidates };
  const yaml = YAML.stringify(output);

  fs.writeFileSync(outputPath, yaml, "utf8");

  console.log(`Extracted ${candidates.length} candidate lines for concept '${concept}'`);
  console.log(`Output: ${outputPath}`);

  printSummary(candidates);
}

main().catch((error) => {
  console.error("Error:", (error as Error).message);
  process.exit(1);
});
