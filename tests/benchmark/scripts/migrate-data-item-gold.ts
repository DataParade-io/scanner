#!/usr/bin/env node
/**
 * Mechanical data-item gold labeling pass (KDATAP-a0e80b).
 *
 *   pnpm exec ts-node tests/benchmark/scripts/migrate-data-item-gold.ts
 *   pnpm exec ts-node tests/benchmark/scripts/migrate-data-item-gold.ts --write
 */
import fs from "fs";
import path from "path";

import { parseArgs } from "node:util";
import YAML from "yaml";

import { resolveDefaultBenchmarkRoot } from "../paths";
import type { AnnotationFile, AnnotationRecord } from "../schema";
import {
  applyDataItemMigrationToRecord,
  buildDataItemMigrationLedger,
  DATA_ITEM_MIGRATION_TASK,
  listAllDataItemAnnotations,
} from "../../eval/canonical/compat/data-item-migration";

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const LEDGER_SHORT_PATH = path.join(REPO_ROOT, "annotations/KDATAP-a0e80b/migration-ledger.json");

function writeLedger(ledger: ReturnType<typeof buildDataItemMigrationLedger>): void {
  fs.mkdirSync(path.dirname(LEDGER_SHORT_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_SHORT_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function migrateRepoDataItems(
  repoKey: string,
  dataItemsPath: string,
  entriesById: Map<string, ReturnType<typeof buildDataItemMigrationLedger>["entries"][number]>,
): { updated: number; total: number } {
  const raw = fs.readFileSync(dataItemsPath, "utf8");
  const parsed = YAML.parse(raw) as AnnotationFile;
  let updated = 0;

  parsed.annotations = parsed.annotations.map((record) => {
    const entry = entriesById.get(record.id);
    if (!entry) {
      throw new Error(`Missing ledger entry for ${repoKey}::${record.id}`);
    }
    const migrated = applyDataItemMigrationToRecord(record, entry);
    if (
      migrated.provenance.review_state !== record.provenance.review_state ||
      migrated.candidate !== record.candidate
    ) {
      updated += 1;
    }
    return migrated;
  });

  fs.writeFileSync(dataItemsPath, YAML.stringify(parsed, { lineWidth: 0 }), "utf8");
  return { updated, total: parsed.annotations.length };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      write: { type: "boolean", default: false },
    },
  });

  const benchmarkRoot = resolveDefaultBenchmarkRoot();
  const ledger = buildDataItemMigrationLedger(benchmarkRoot);
  writeLedger(ledger);

  console.log(`Migration task: ${DATA_ITEM_MIGRATION_TASK}`);
  console.log(`Total rows: ${ledger.totalRows}`);
  console.log(`Source-token no map match: ${ledger.sourceTokenNoMapMatch}`);
  console.log(`Source-token keyed (census): ${ledger.sourceTokenKeyed}`);
  console.log(
    `Accepted source-token before → after: ${ledger.acceptedSourceTokenBefore} → ${ledger.acceptedSourceTokenAfter}`,
  );
  console.log("Buckets:", ledger.buckets);
  console.log(`Wrote ${LEDGER_SHORT_PATH}`);

  if (ledger.totalRows !== 436) {
    throw new Error(`Expected 436 ledger entries, got ${ledger.totalRows}`);
  }

  if (!values.write) {
    console.log("Dry run — pass --write to update data_items.yaml files.");
    return;
  }

  const entriesById = new Map(ledger.entries.map((entry) => [entry.annotationId, entry]));
  const rows = listAllDataItemAnnotations(benchmarkRoot);
  const byRepo = new Map<string, AnnotationRecord[]>();
  for (const { repoKey, record } of rows) {
    const group = byRepo.get(repoKey) ?? [];
    group.push(record);
    byRepo.set(repoKey, group);
  }

  for (const repoKey of [...byRepo.keys()].sort()) {
    const dataItemsPath = path.join(
      benchmarkRoot,
      "repos",
      repoKey,
      "annotations",
      "data_items.yaml",
    );
    const { updated, total } = migrateRepoDataItems(repoKey, dataItemsPath, entriesById);
    console.log(`${repoKey}: updated ${updated}/${total} data_items rows`);
  }
}

main();
