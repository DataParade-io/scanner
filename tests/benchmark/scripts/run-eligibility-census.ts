import path from "path";

import {
  runEligibilityCensus,
  writeEligibilityCensusReport,
} from "../eligibility-census";
import { resolveDefaultBenchmarkRoot } from "../paths";

async function main(): Promise<void> {
  const benchmarkRoot = resolveDefaultBenchmarkRoot();
  const report = await runEligibilityCensus({ benchmarkRoot });
  const outputPath = path.join(
    benchmarkRoot,
    "reports",
    "eligibility-census.json",
  );
  await writeEligibilityCensusReport(report, outputPath);
  console.log(`Eligibility census written to ${outputPath}`);
  console.log(`Packets: ${report.totals.packets}`);
  console.log(`File-count cap hits: ${report.totals.fileCountCapHits}`);
  console.log(`Total-byte cap hits: ${report.totals.totalByteCapHits}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
