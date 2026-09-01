#!/usr/bin/env node
/**
 * Census data-flow gold rows (KDATAP-8e7756).
 *
 *   pnpm exec ts-node tests/benchmark/scripts/census-data-flow-gold.ts
 */
import fs from "fs";
import path from "path";

import { buildFlowCensus, FLOW_MIGRATION_TASK } from "../../eval/canonical/compat/flow-migration";
import { resolveDefaultBenchmarkRoot } from "../paths";

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const OUTPUT_PATH = path.join(REPO_ROOT, "annotations", FLOW_MIGRATION_TASK, "census.json");

function main(): void {
  const census = buildFlowCensus(resolveDefaultBenchmarkRoot());
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(census, null, 2)}\n`, "utf8");

  console.log(`Census: ${census.totalRows} rows, ${census.distinctKeys} distinct keys`);
  console.log(
    `review_state: accepted=${census.acceptedReviewState}, ` +
      `needs_adjudication=${census.needsAdjudicationReviewState}`,
  );
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main();
