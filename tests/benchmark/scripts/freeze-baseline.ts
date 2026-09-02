#!/usr/bin/env node
/**
 * Run the canonical evaluator and freeze a baseline artifact (KDATAP-3b935c).
 * Refuses to write when readiness.status !== pass.
 */
import fs from "fs";
import path from "path";

import { parseArgs } from "node:util";

import {
  buildBaselineArtifact,
  formatReadinessReport,
  renderBaselineMarkdown,
} from "../baseline";
import { resolveDefaultBenchmarkRoot } from "../paths";
import { runFourLayerScorecard } from "../run-four-layer-scorecard";

const DEFAULT_OUTPUT_JSON = path.join(
  "tests",
  "fixtures",
  "baseline",
  "series-1-baseline-artifact.json",
);

function usage(): void {
  console.log("Usage: node dist/tests/benchmark/scripts/freeze-baseline.js [options]");
  console.log("");
  console.log("Options:");
  console.log(`  --output <path>   Baseline JSON path (default: ${DEFAULT_OUTPUT_JSON})`);
  console.log("  --series-label    Series label (default: series-1)");
  console.log("  --dry-run         Evaluate and print readiness without writing files");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      output: { type: "string", default: DEFAULT_OUTPUT_JSON },
      "series-label": { type: "string", default: "series-1" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    usage();
    process.exit(0);
  }

  const benchmarkRoot = resolveDefaultBenchmarkRoot(__dirname);
  const generatedAt = new Date().toISOString();
  const scorecard = await runFourLayerScorecard({ benchmarkRoot });

  const artifact = buildBaselineArtifact({
    seriesLabel: values["series-label"]!,
    predecessor: null,
    generatedAt,
    scorecard,
    benchmarkRoot,
    scannerGitSha: scorecard.scannerGitSha,
  });

  console.log(formatReadinessReport(artifact.readiness));

  if (artifact.readiness.status !== "pass") {
    console.error(
      `Refusing to freeze baseline: readiness.status=${artifact.readiness.status} (${artifact.readiness.blockers.length} blockers)`,
    );
    process.exit(1);
  }

  if (values["dry-run"]) {
    console.log("Dry run complete — readiness passed; no files written.");
    return;
  }

  const outputJson = path.resolve(values.output!);
  const outputMd = outputJson.replace(/\.json$/i, ".md");
  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  fs.writeFileSync(outputJson, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  fs.writeFileSync(outputMd, renderBaselineMarkdown(artifact), "utf8");

  console.log(`Wrote baseline artifact: ${outputJson}`);
  console.log(`Wrote baseline markdown: ${outputMd}`);
  console.log(`fingerprintDigest: ${artifact.fingerprint.fingerprintDigest}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
