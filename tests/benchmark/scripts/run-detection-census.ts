#!/usr/bin/env node
/**
 * Detection coverage census for materialized benchmark packets.
 *
 *   node dist/tests/benchmark/scripts/run-detection-census.js
 *   node dist/tests/benchmark/scripts/run-detection-census.js easy-school flask-login
 *   node dist/tests/benchmark/scripts/run-detection-census.js --write-report
 *
 * Not invoked by CI or pnpm test.
 */
import {
  formatDetectionCensusTable,
  runDetectionCensus,
  writeDetectionCensusReport,
} from "../detection-census";

function usage(): void {
  console.log(
    "Usage: node dist/tests/benchmark/scripts/run-detection-census.js [repo-key ...] [--write-report]",
  );
  console.log("Example: pnpm run benchmark:census -- --write-report");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    process.exit(0);
  }

  const writeReport = args.includes("--write-report");
  const repoKeys = args.filter((arg) => !arg.startsWith("--"));

  const report = await runDetectionCensus({
    repoKeys: repoKeys.length > 0 ? repoKeys : undefined,
  });

  console.log(formatDetectionCensusTable(report));

  if (writeReport) {
    const { jsonPath, markdownPath } = writeDetectionCensusReport(report);
    console.log("");
    console.log(`Wrote ${jsonPath}`);
    console.log(`Wrote ${markdownPath}`);
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
