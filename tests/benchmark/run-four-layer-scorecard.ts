import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import type { ReviewState } from "./schema";
import {
  buildScorecardVector,
  formatScorecardVectorMarkdown,
  resolveFlowLayerScoreable,
  type ScorecardVector,
} from "./scorecard-vector";
import {
  runBenchmark,
  type RunBenchmarkOptions,
} from "./run-benchmark";
import { resolveDefaultBenchmarkRoot } from "./paths";
import { collectGoldPopulation } from "./baseline";

export interface RunFourLayerScorecardOptions extends RunBenchmarkOptions {
  writeReportPath?: string;
}

function scannerGitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function resolveReviewStates(options: RunBenchmarkOptions): ReviewState[] {
  if (options.reviewStates) {
    return options.reviewStates;
  }
  if (options.includeProposed) {
    return ["accepted", "proposed", "needs_adjudication"];
  }
  return ["accepted"];
}

export async function runFourLayerScorecard(
  options: RunFourLayerScorecardOptions = {},
): Promise<ScorecardVector> {
  const results = await runBenchmark(options);
  const benchmarkRoot = options.benchmarkRoot ?? resolveDefaultBenchmarkRoot(__dirname);
  const goldPopulation = collectGoldPopulation(benchmarkRoot);
  const flowLayerScoreable = resolveFlowLayerScoreable(goldPopulation);
  return buildScorecardVector({
    scannerGitSha: scannerGitSha(),
    generatedAt: new Date().toISOString(),
    reviewStates: resolveReviewStates(options),
    flowLayerScoreable,
    packets: results.map((result) => ({
      repoKey: result.repoKey,
      evalCases: result.evalCases,
      layerScores: result.layerScores,
      scanResult: result.scanResult,
      canonicalRecords: result.canonicalRecords,
    })),
  });
}

export async function writeScorecardReport(
  vector: ScorecardVector,
  outputPath: string,
): Promise<void> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(vector, null, 2)}\n`, "utf8");
  const markdownPath = outputPath.replace(/\.json$/i, ".md");
  fs.writeFileSync(markdownPath, formatScorecardVectorMarkdown(vector), "utf8");
}

function parseCliArgs(args: string[]): {
  repoKeys: string[];
  includeProposed?: boolean;
  reviewStates?: ReviewState[];
  writeReportPath?: string;
} {
  const reviewStatesArg = args.find((arg) => arg.startsWith("--review-states="));
  let reviewStates: ReviewState[] | undefined;
  if (reviewStatesArg) {
    const value = reviewStatesArg.slice("--review-states=".length);
    const states = value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) as ReviewState[];
    if (states.length > 0) {
      reviewStates = states;
    }
  }

  const writeReportArg = args.find((arg) => arg.startsWith("--write-report"));
  let writeReportPath: string | undefined;
  if (writeReportArg) {
    if (writeReportArg.includes("=")) {
      writeReportPath = writeReportArg.slice("--write-report=".length);
    } else {
      const index = args.indexOf(writeReportArg);
      writeReportPath = args[index + 1];
    }
  }

  const repoKeys = args.filter(
    (arg) =>
      !arg.startsWith("--") &&
      arg !== writeReportPath,
  );

  return {
    repoKeys,
    includeProposed: args.includes("--include-proposed"),
    reviewStates,
    writeReportPath,
  };
}

function isProvisionalRun(options: RunFourLayerScorecardOptions): boolean {
  const states =
    options.reviewStates ??
    (options.includeProposed
      ? (["proposed", "needs_adjudication", "accepted"] as ReviewState[])
      : (["accepted"] as ReviewState[]));
  return !states.every((state) => state === "accepted");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { repoKeys, includeProposed, reviewStates, writeReportPath } = parseCliArgs(args);

  const options: RunFourLayerScorecardOptions = {
    repoKeys: repoKeys.length > 0 ? repoKeys : undefined,
    includeProposed,
    reviewStates,
    writeReportPath,
  };

  if (isProvisionalRun(options)) {
    console.log(
      "\n*** PROVISIONAL SCORECARD RUN ***\n" +
        "Metrics include non-accepted annotations. Per-layer gates are provisional.\n" +
        "Accept annotations before citing headline metrics.\n",
    );
  }

  const vector = await runFourLayerScorecard(options);

  console.log(formatScorecardVectorMarkdown(vector));

  if (writeReportPath) {
    const resolvedPath = path.resolve(writeReportPath);
    await writeScorecardReport(vector, resolvedPath);
    console.log(`\nWrote ${resolvedPath}`);
    console.log(`Wrote ${resolvedPath.replace(/\.json$/i, ".md")}`);
  } else {
    console.log("\n--- JSON ---");
    console.log(JSON.stringify(vector, null, 2));
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
