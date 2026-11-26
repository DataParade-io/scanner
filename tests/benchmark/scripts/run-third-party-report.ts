#!/usr/bin/env node
/**
 * Vendor-level third-party report (DATAP-895).
 *
 *   node dist/tests/benchmark/scripts/run-third-party-report.js
 *   node dist/tests/benchmark/scripts/run-third-party-report.js marketmenow ghost
 *   node dist/tests/benchmark/scripts/run-third-party-report.js --check-only marketmenow
 *   node dist/tests/benchmark/scripts/run-third-party-report.js --accepted-only --write-report
 *
 * --check-only parses the labels and checks every cited file and line against the clone,
 * without scanning. Not invoked by CI or pnpm test.
 */
import path from "path";

import { assertMaterialized, getReposMetadataRoot } from "../run-benchmark";
import type { ReviewState } from "../schema";
import { loadThirdPartyLabels } from "../third-party-labels";
import {
  buildThirdPartyReport,
  checkLabelsAgainstClone,
  listThirdPartyPackets,
  renderThirdPartyReportMarkdown,
  runThirdPartyPacket,
  writeThirdPartyReport,
} from "../third-party-report";

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const named = args.filter((arg) => !arg.startsWith("--"));
  const repoKeys = named.length > 0 ? named : listThirdPartyPackets();

  if (args.includes("--check-only")) {
    let failed = false;
    for (const repoKey of repoKeys) {
      const labels = loadThirdPartyLabels(path.join(getReposMetadataRoot(), repoKey));
      if (!labels) {
        console.log(`${repoKey}: no third_parties.yaml`);
        failed = true;
        continue;
      }
      const problems = checkLabelsAgainstClone(labels, assertMaterialized(repoKey));
      console.log(`${repoKey}: ${labels.vendors.length} vendors, ${problems.length} problems`);
      for (const problem of problems) {
        console.log(`  ${problem}`);
      }
      failed ||= problems.length > 0;
    }
    process.exit(failed ? 1 : 0);
  }

  const reviewStates: ReviewState[] = args.includes("--accepted-only")
    ? ["accepted"]
    : ["accepted", "proposed", "needs_adjudication"];
  const rows = [];
  for (const repoKey of repoKeys) {
    rows.push(await runThirdPartyPacket(repoKey, { reviewStates }));
  }
  const report = buildThirdPartyReport(rows, reviewStates);
  console.log(renderThirdPartyReportMarkdown(report));
  if (args.includes("--write-report")) {
    const { jsonPath, markdownPath } = writeThirdPartyReport(report);
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
