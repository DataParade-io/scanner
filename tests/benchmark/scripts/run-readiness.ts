#!/usr/bin/env node
/**
 * Evaluate baseline readiness gates against the pinned corpus (KDATAP-b87baf).
 * Static gold checks always run; runtime checks require --scorecard-json.
 */
import fs from "fs";
import path from "path";

import { parseArgs } from "node:util";

import {
  collectGoldPopulation,
  collectMigrationIncompleteAccounting,
  evaluateBaselineReadiness,
  formatReadinessReport,
} from "../baseline";
import { resolveDefaultBenchmarkRoot } from "../paths";
import type { ScorecardVector } from "../scorecard-vector";

function usage(): void {
  console.log("Usage: node dist/tests/benchmark/scripts/run-readiness.js [options]");
  console.log("");
  console.log("Options:");
  console.log("  --scorecard-json <path>   Include runtime path-contract and unscorable checks");
  console.log("  --write-report <path>     Write JSON readiness evidence");
  console.log("  --require-pass            Exit 1 unless readiness.status=pass");
}

function main(): void {
  const { values } = parseArgs({
    options: {
      "scorecard-json": { type: "string" },
      "write-report": { type: "string" },
      "require-pass": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    usage();
    process.exit(0);
  }

  const benchmarkRoot = resolveDefaultBenchmarkRoot(__dirname);
  const goldPopulation = collectGoldPopulation(benchmarkRoot);
  const migrationIncomplete = collectMigrationIncompleteAccounting(benchmarkRoot);

  const scorecardPath = values["scorecard-json"];
  const scorecard = scorecardPath
    ? (JSON.parse(fs.readFileSync(scorecardPath, "utf8")) as ScorecardVector)
    : undefined;

  const readiness = evaluateBaselineReadiness({
    benchmarkRoot,
    goldPopulation,
    migrationIncomplete,
    scorecard,
    requireMaterializations: true,
    requireRuntimeChecks: Boolean(scorecard),
  });

  console.log(formatReadinessReport(readiness));

  const reportPath = values["write-report"];
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(readiness, null, 2)}\n`, "utf8");
    console.log(`Wrote readiness evidence: ${reportPath}`);
  }

  if (values["require-pass"] && readiness.status !== "pass") {
    process.exit(1);
  }
}

main();
