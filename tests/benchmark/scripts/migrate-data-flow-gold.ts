#!/usr/bin/env node
/**
 * Mechanical migration of data-flow gold to flow candidate blocks (KDATAP-8e7756).
 *
 *   pnpm exec ts-node tests/benchmark/scripts/migrate-data-flow-gold.ts [--write]
 */
import fs from "fs";
import path from "path";

import { parseArgs } from "node:util";
import YAML from "yaml";

import {
  buildFlowCensus,
  buildFlowMigrationLedger,
  FLOW_MIGRATION_TASK,
  listAcceptedComponentsWithCanonical,
  listComponentCandidatesForFlow,
  proposeFlowCandidate,
} from "../../eval/canonical/compat/flow-migration";
import type { AnnotationFile, AnnotationRecord } from "../schema";
import { resolveDefaultBenchmarkRoot } from "../paths";
import { listBenchmarkRepoKeys } from "../run-benchmark";

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const FLYWHEEL_DIR = path.join(REPO_ROOT, "annotations", FLOW_MIGRATION_TASK);
const LEDGER_PATH = path.join(FLYWHEEL_DIR, "migration-ledger.json");
const CENSUS_PATH = path.join(FLYWHEEL_DIR, "census.json");
const PASS_PATH = path.join(FLYWHEEL_DIR, "pass.md");

function migrateFlowRecord(
  record: AnnotationRecord,
  components: AnnotationRecord[],
): AnnotationRecord {
  const candidate = proposeFlowCandidate(record, components);
  record.candidate = candidate;
  record.provenance = {
    ...record.provenance,
    review_state: "needs_adjudication",
  };
  return record;
}

function migrateRepo(repoKey: string, benchmarkRoot: string, write: boolean): number {
  const repoDir = path.join(benchmarkRoot, "repos", repoKey);
  const flowsPath = path.join(repoDir, "annotations", "data_flows.yaml");
  const manifestPath = path.join(repoDir, "manifest.yaml");

  const raw = fs.readFileSync(flowsPath, "utf8");
  const parsed = YAML.parse(raw) as AnnotationFile;
  const components = listAcceptedComponentsWithCanonical(repoDir);

  let updated = 0;
  for (const record of parsed.annotations) {
    if (record.layer !== "data_flows") {
      continue;
    }
    migrateFlowRecord(record, components);
    updated += 1;
  }

  if (write) {
    fs.writeFileSync(flowsPath, YAML.stringify(parsed, { lineWidth: 0 }), "utf8");
    const manifest = YAML.parse(fs.readFileSync(manifestPath, "utf8")) as {
      annotation_version: number;
    };
    manifest.annotation_version += 1;
    fs.writeFileSync(manifestPath, YAML.stringify(manifest, { lineWidth: 0 }), "utf8");
  }

  return updated;
}

function writeFlywheel(ledger: ReturnType<typeof buildFlowMigrationLedger>): void {
  fs.mkdirSync(FLYWHEEL_DIR, { recursive: true });
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

  const census = buildFlowCensus();
  fs.writeFileSync(CENSUS_PATH, `${JSON.stringify(census, null, 2)}\n`, "utf8");

  const pass = `# Annotation pass

## Task

${FLOW_MIGRATION_TASK} — Regold data flows against canonical endpoints.

Parent: KDATAP-b0d5e2 (corpus gold migration).

## Scope

All 29 corpus packets under \`tests/benchmark/repos/*/annotations/data_flows.yaml\`.

## Migration method

Mechanical script \`tests/benchmark/scripts/migrate-data-flow-gold.ts\`:

1. Flip all 436 legacy \`review_state: accepted\` rows to \`needs_adjudication\`
2. Attach non-scoring \`candidate.kind: flow\` proposals from pinned evidence + component gold + rationale
3. Preserve legacy \`subject.key\`, \`subject.name\`, and \`expected.labels\` unchanged
4. No scanner output used as gold input; no component gold rewrites

## Counts

| Metric | Value |
| --- | ---: |
| Total flow rows migrated | ${ledger.totalRows} |
| graph_edge proposals | ${ledger.buckets.graph_edge} |
| intra_component_lineage | ${ledger.buckets.intra_component_lineage} |
| rejection (negatives) | ${ledger.buckets.rejection} |
| unresolved | ${ledger.buckets.unresolved} |

Ledger: \`annotations/${FLOW_MIGRATION_TASK}/migration-ledger.json\`.

## Human review

Pending — Ryan Alyn Porter.
`;
  fs.writeFileSync(PASS_PATH, pass, "utf8");
}

function main(): void {
  const { values } = parseArgs({
    options: {
      write: { type: "boolean", default: false },
    },
  });

  const benchmarkRoot = resolveDefaultBenchmarkRoot();
  const ledger = buildFlowMigrationLedger(benchmarkRoot);

  if (ledger.totalRows !== 436) {
    throw new Error(`Expected 436 flow rows, found ${ledger.totalRows}`);
  }

  writeFlywheel(ledger);

  console.log(
    `Migration ledger: ${ledger.totalRows} rows ` +
      `(graph_edge=${ledger.buckets.graph_edge}, ` +
      `lineage=${ledger.buckets.intra_component_lineage}, ` +
      `rejection=${ledger.buckets.rejection}, ` +
      `unresolved=${ledger.buckets.unresolved})`,
  );
  console.log(`Wrote ${LEDGER_PATH}`);

  if (!values.write) {
    console.log("Dry run — pass --write to update data_flows.yaml files.");
    return;
  }

  let totalUpdated = 0;
  for (const repoKey of listBenchmarkRepoKeys(benchmarkRoot)) {
    const updated = migrateRepo(repoKey, benchmarkRoot, true);
    totalUpdated += updated;
    console.log(`${repoKey}: migrated ${updated} flow rows`);
  }

  if (totalUpdated !== 436) {
    throw new Error(`Write accounting mismatch: updated ${totalUpdated}, expected 436`);
  }

  const postCensus = buildFlowCensus(benchmarkRoot);
  if (postCensus.totalRows !== 436) {
    throw new Error(`Post-write census total ${postCensus.totalRows} !== 436`);
  }
  if (postCensus.acceptedReviewState !== 0) {
    throw new Error(`Post-write accepted review_state count ${postCensus.acceptedReviewState} !== 0`);
  }
  if (postCensus.needsAdjudicationReviewState !== 436) {
    throw new Error(
      `Post-write needs_adjudication count ${postCensus.needsAdjudicationReviewState} !== 436`,
    );
  }

  fs.writeFileSync(CENSUS_PATH, `${JSON.stringify(postCensus, null, 2)}\n`, "utf8");
  console.log(`Post-write census: ${postCensus.totalRows} rows, 0 accepted`);
}

main();
