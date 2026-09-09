import fs from "fs";
import path from "path";

import type { EvalCase, EvalLayer, EvalScoreReport, FixtureScanResult } from "../eval/types";
import { scoreEvalCasesByLayer } from "../eval/score";
import { loadAnnotations, loadBenchmarkManifest, loadLayerScopes } from "./manifest";
import type { ReviewState } from "./schema";
import { annotationsToEvalCases, type ToEvalCasesOptions } from "./to-eval-cases";
import { eligibleProcessedPaths } from "../eval/eligibility/ledger-access";
import { normalizeRepoRelativePath, scanRepoByManifestLayers } from "./scan-repo";
import { resolveDefaultBenchmarkRoot } from "./paths";
import {
  MaterializationInvalidError,
  validateMaterializedRepo,
} from "./validate-materialization";
import {
  loadPacketCanonicalRecordsWithDiagnostics,
  type PacketCanonicalRecordWithDiagnostics,
} from "./layer-report-accounting";

const DEFAULT_BENCHMARK_ROOT = resolveDefaultBenchmarkRoot();

export function getBenchmarkRoot(benchmarkRoot?: string): string {
  return benchmarkRoot ?? DEFAULT_BENCHMARK_ROOT;
}

export function getReposMetadataRoot(benchmarkRoot?: string): string {
  return path.join(getBenchmarkRoot(benchmarkRoot), "repos");
}

export function getCacheRoot(benchmarkRoot?: string): string {
  return path.join(getBenchmarkRoot(benchmarkRoot), ".cache", "repos");
}

export function listBenchmarkRepoKeys(benchmarkRoot?: string): string[] {
  const reposRoot = getReposMetadataRoot(benchmarkRoot);
  return fs
    .readdirSync(reposRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function resolveMaterializedRepoPath(
  repoKey: string,
  benchmarkRoot?: string,
): string {
  const repoDir = path.join(getReposMetadataRoot(benchmarkRoot), repoKey);
  const manifest = loadBenchmarkManifest(repoDir);
  return path.join(getCacheRoot(benchmarkRoot), `${repoKey}@${manifest.commit}`);
}

export class MaterializationMissingError extends Error {
  readonly repoKey: string;
  readonly expectedPath: string;

  constructor(repoKey: string, expectedPath: string) {
    super(
      `Benchmark repo '${repoKey}' is not materialized at ${expectedPath}. ` +
        `Run: pnpm run benchmark:materialize ${repoKey}`,
    );
    this.name = "MaterializationMissingError";
    this.repoKey = repoKey;
    this.expectedPath = expectedPath;
  }
}

export { MaterializationInvalidError } from "./validate-materialization";

export function assertMaterialized(repoKey: string, benchmarkRoot?: string): string {
  const materializedPath = resolveMaterializedRepoPath(repoKey, benchmarkRoot);
  if (!fs.existsSync(materializedPath)) {
    throw new MaterializationMissingError(repoKey, materializedPath);
  }

  const repoDir = path.join(getReposMetadataRoot(benchmarkRoot), repoKey);
  const manifest = loadBenchmarkManifest(repoDir);
  validateMaterializedRepo(repoKey, materializedPath, manifest);
  return materializedPath;
}

export interface RunBenchmarkRepoOptions extends ToEvalCasesOptions {
  benchmarkRoot?: string;
  scanRepo?: (repoKey: string, repoRoot: string) => Promise<FixtureScanResult>;
}

export interface BenchmarkRepoResult {
  repoKey: string;
  materializedPath: string;
  evalCases: EvalCase[];
  scanResult: FixtureScanResult;
  layerScores: Partial<Record<EvalLayer, EvalScoreReport>>;
  canonicalRecords: PacketCanonicalRecordWithDiagnostics[];
}

export interface RunBenchmarkOptions extends RunBenchmarkRepoOptions {
  repoKeys?: string[];
  /** Maximum number of repository scans to run in parallel (default 1). */
  concurrency?: number;
}

export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  runItem: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await runItem(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

function loadEvalCasesForRepo(
  repoKey: string,
  benchmarkRoot?: string,
  options: ToEvalCasesOptions = {},
): EvalCase[] {
  const repoDir = path.join(getReposMetadataRoot(benchmarkRoot), repoKey);
  const manifest = loadBenchmarkManifest(repoDir);
  const layerScopes = loadLayerScopes(repoDir);
  const evalCases: EvalCase[] = [];

  for (const layer of manifest.coverage.layers) {
    const annotations = loadAnnotations(repoDir, layer);
    evalCases.push(
      ...annotationsToEvalCases(annotations, repoKey, { ...options, layerScopes }),
    );
  }

  return evalCases;
}

export async function runBenchmarkRepo(
  repoKey: string,
  options: RunBenchmarkRepoOptions = {},
): Promise<BenchmarkRepoResult> {
  const materializedPath = assertMaterialized(repoKey, options.benchmarkRoot);
  const evalCases = loadEvalCasesForRepo(repoKey, options.benchmarkRoot, {
    includeProposed: options.includeProposed,
    reviewStates: options.reviewStates,
  });

  const repoDir = path.join(getReposMetadataRoot(options.benchmarkRoot), repoKey);
  const manifest = loadBenchmarkManifest(repoDir);
  const scanFn =
    options.scanRepo ??
    ((key: string, root: string) =>
      scanRepoByManifestLayers(key, root, manifest.coverage.layers));
  const scanResult = await scanFn(repoKey, materializedPath);
  const layerScores = scoreEvalCasesByLayer(evalCases, [scanResult]);
  const canonicalRecords = loadPacketCanonicalRecordsWithDiagnostics(
    repoKey,
    options.benchmarkRoot,
  );

  return {
    repoKey,
    materializedPath,
    evalCases,
    scanResult,
    layerScores,
    canonicalRecords,
  };
}

export async function runBenchmark(
  options: RunBenchmarkOptions = {},
): Promise<BenchmarkRepoResult[]> {
  const repoKeys =
    options.repoKeys ?? listBenchmarkRepoKeys(options.benchmarkRoot);
  const concurrency = options.concurrency ?? 1;

  return runWithConcurrency(repoKeys, concurrency, (repoKey) =>
    runBenchmarkRepo(repoKey, options),
  );
}

function formatRate(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function printScoreBlock(title: string, score: EvalScoreReport, evalCases: EvalCase[]): void {
  console.log(title);
  console.log(`  Eval cases: ${evalCases.length}`);
  console.log(`  Recall: ${formatRate(score.scores.recall)}`);
  console.log(`  Label accuracy: ${formatRate(score.scores.labelAccuracy)}`);
  console.log(`  Correct-label recall: ${formatRate(score.scores.correctLabelRecall)}`);
  console.log(`  Precision: ${formatRate(score.scores.precision)}`);
  console.log(`  Negative pass rate: ${formatRate(score.scores.negativeCasePassRate)}`);
  console.log(`  Unread cases: ${score.scores.unreadCount}`);
}

function printRepoResult(result: BenchmarkRepoResult): void {
  const { repoKey, materializedPath, evalCases, scanResult, layerScores } = result;
  console.log(`\n=== ${repoKey} ===`);
  console.log(`Materialized: ${materializedPath}`);
  const eligibleTotal = Object.values(scanResult.eligibilityLedgers ?? {}).reduce(
    (sum, ledger) => sum + (ledger ? eligibleProcessedPaths(ledger).length : 0),
    0,
  );
  console.log(`Layer-eligible paths (sum across layers): ${eligibleTotal}`);
  console.log(`Scanned files (diagnostic union): ${scanResult.scannedFiles.length}`);
  const findingsByLayer = new Map<string, number>();
  for (const finding of scanResult.findings) {
    const layer = finding.layer ?? "untagged";
    findingsByLayer.set(layer, (findingsByLayer.get(layer) ?? 0) + 1);
  }
  console.log(`Findings: ${scanResult.findings.length}`);
  for (const [layer, count] of [...findingsByLayer.entries()].sort()) {
    console.log(`  ${layer}: ${count}`);
  }
  const layerOrder: EvalLayer[] = [
    "mentions",
    "data-items",
    "components",
    "data-flows",
    "raw-hits",
    "data-actions",
  ];
  for (const layer of layerOrder) {
    const layerScore = layerScores[layer];
    if (!layerScore) {
      continue;
    }
    const layerCases = evalCases.filter((entry) => entry.layer === layer);
    const label =
      layer === "raw-hits" || layer === "data-actions"
        ? `Diagnostic ${layer}:`
        : `Layer ${layer}:`;
    printScoreBlock(label, layerScore, layerCases);
  }

  const unreadCases = Object.values(layerScores).flatMap((layerScore) =>
    layerScore ? layerScore.caseResults.filter((caseResult) => caseResult.unread) : [],
  );
  if (unreadCases.length > 0) {
    console.log("Unread evidence files:");
    for (const caseResult of unreadCases) {
      const evalCase = evalCases.find((entry) => entry.id === caseResult.caseId);
      if (evalCase) {
        console.log(`  - ${evalCase.id}: ${evalCase.evidence.file_path}`);
      }
    }
  }
}

function parseConcurrency(args: string[]): number | undefined {
  const concurrencyArg = args.find((arg) => arg.startsWith("--concurrency="));
  if (!concurrencyArg) {
    return undefined;
  }
  const value = Number.parseInt(concurrencyArg.slice("--concurrency=".length), 10);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`Invalid --concurrency value: ${concurrencyArg}`);
  }
  return value;
}

function parseReviewStates(args: string[]): {
  reviewStates?: ReviewState[];
  includeProposed?: boolean;
} {
  const reviewStatesArg = args.find((arg) => arg.startsWith("--review-states="));
  if (reviewStatesArg) {
    const value = reviewStatesArg.slice("--review-states=".length);
    const states = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as ReviewState[];
    if (states.length > 0) {
      return { reviewStates: states };
    }
  }
  const includeProposed = args.includes("--include-proposed");
  return { includeProposed };
}

function isProvisionalRun(options: ToEvalCasesOptions): boolean {
  const states = options.reviewStates ?? (options.includeProposed ? ["proposed", "needs_adjudication", "accepted"] : ["accepted"]);
  return !states.every((s) => s === "accepted");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { reviewStates, includeProposed } = parseReviewStates(args);
  const concurrency = parseConcurrency(args);
  const repoKeys = args.filter(
    (arg) => !arg.startsWith("--"),
  );

  const options: RunBenchmarkOptions = {
    repoKeys: repoKeys.length > 0 ? repoKeys : undefined,
    includeProposed,
    reviewStates,
    concurrency,
  };

  if (isProvisionalRun(options)) {
    console.log(
      "\n*** PROVISIONAL BENCHMARK RUN ***\n" +
        "Metrics include non-accepted annotations. Do not cite as headline metrics.\n" +
        "Accept annotations before reporting final scores.\n",
    );
  }

  const results = await runBenchmark(options);

  for (const result of results) {
    printRepoResult(result);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
