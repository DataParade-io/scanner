#!/usr/bin/env node
/**
 * Validate all pinned benchmark packet materializations under tests/benchmark/.cache/.
 * Not invoked by PR CI — use the baseline-corpus workflow or run locally after materialize.
 */
import fs from "fs";
import path from "path";

import {
  buildMaterializationValidationReport,
  isMaterializationValidationPassing,
} from "../materialization-validation";
import { resolveDefaultBenchmarkRoot } from "../paths";

function main(): void {
  const benchmarkRoot = resolveDefaultBenchmarkRoot(__dirname);
  const report = buildMaterializationValidationReport(benchmarkRoot);
  const reportsDir = path.join(benchmarkRoot, "reports");
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, "materialization-validation.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(
    `Materialization validation: ${report.validCount}/${report.totalPackets} packets valid`,
  );
  console.log(`Report: ${reportPath}`);

  if (!isMaterializationValidationPassing(report)) {
    for (const failure of report.failures) {
      console.error(
        `  FAIL ${failure.repoKey}: ${failure.validationStatus}` +
          (failure.reason ? ` (${failure.reason})` : ""),
      );
    }
    console.error("");
    console.error("Run: pnpm run benchmark:materialize -- --all");
    process.exit(1);
  }
}

main();
