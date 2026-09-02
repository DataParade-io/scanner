#!/usr/bin/env node
/**
 * Slice-2 data-item adjudication (KDATAP-6b1c67) — remaining needs_adjudication rows.
 *
 *   pnpm exec ts-node tests/benchmark/scripts/adjudicate-data-item-gold-slice2.ts
 *   pnpm exec ts-node tests/benchmark/scripts/adjudicate-data-item-gold-slice2.ts --write-ledger
 *   pnpm exec ts-node tests/benchmark/scripts/adjudicate-data-item-gold-slice2.ts --apply
 */
import fs from "fs";
import path from "path";

import { parseArgs } from "node:util";
import YAML from "yaml";

import { digestCorpusGold } from "../baseline/digests";
import { resolveDefaultBenchmarkRoot } from "../paths";
import type { AnnotationFile, AnnotationRecord } from "../schema";
import type { AdjudicationLedgerEntry } from "../../eval/canonical/compat/data-item-adjudication";
import {
  buildSlice2AdjudicationLedger,
  DATA_ITEM_ADJUDICATION_SLICE2_TASK,
  listUnresolvedDataItemRows,
  type Slice2AdjudicationLedger,
} from "../../eval/canonical/compat/data-item-adjudication-slice2";
import {
  buildDataItemCandidate,
  listAllDataItemAnnotations,
  type DataItemMigrationBucket,
} from "../../eval/canonical/compat/data-item-migration";

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const LEDGER_SHORT_PATH = path.join(
  REPO_ROOT,
  "annotations/KDATAP-6b1c67/adjudication-ledger.json",
);
const CORPUS_GOLD_DIGEST_PIN = path.join(
  REPO_ROOT,
  "tests/fixtures/baseline/pins/corpus-gold.digest",
);

function writeLedger(ledger: Slice2AdjudicationLedger): void {
  fs.mkdirSync(path.dirname(LEDGER_SHORT_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_SHORT_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function loadLedger(): Slice2AdjudicationLedger {
  if (!fs.existsSync(LEDGER_SHORT_PATH)) {
    throw new Error(`Missing adjudication ledger at ${LEDGER_SHORT_PATH}`);
  }
  return JSON.parse(fs.readFileSync(LEDGER_SHORT_PATH, "utf8")) as Slice2AdjudicationLedger;
}

function applyLedgerEntryToRecord(
  record: AnnotationRecord,
  entry: AdjudicationLedgerEntry,
): AnnotationRecord {
  const updated: AnnotationRecord = {
    ...record,
    provenance: { ...record.provenance },
    expected: { ...record.expected, labels: [...record.expected.labels] },
  };

  if (entry.labelCorrection) {
    updated.expected.labels = [...entry.labelCorrection.after];
  }

  if (entry.disposition === "accept" && entry.conceptLeaf && entry.identityKey) {
    updated.provenance.review_state = "accepted";
    const ruleId = entry.identityKey.replace(/^data_item:/, "");
    updated.candidate = buildDataItemCandidate(
      entry.sourceBucket as DataItemMigrationBucket,
      {
        ruleId,
        conceptLeaf: entry.conceptLeaf,
        conceptAncestry: entry.conceptAncestry ?? [entry.conceptLeaf],
      },
      entry.evidenceValidation,
    );
  } else if (entry.disposition === "reject") {
    updated.provenance.review_state = "rejected";
    delete updated.candidate;
  } else {
    updated.provenance.review_state = "needs_adjudication";
    delete updated.candidate;
  }

  return updated;
}

function applyLedgerToYaml(ledger: Slice2AdjudicationLedger, benchmarkRoot: string): void {
  const entriesById = new Map(ledger.entries.map((entry) => [entry.annotationId, entry]));
  const rows = listAllDataItemAnnotations(benchmarkRoot);
  const byRepo = new Map<string, AnnotationRecord[]>();
  for (const { repoKey, record } of rows) {
    const group = byRepo.get(repoKey) ?? [];
    group.push(record);
    byRepo.set(repoKey, group);
  }

  let appliedCount = 0;
  for (const repoKey of [...byRepo.keys()].sort()) {
    const dataItemsPath = path.join(
      benchmarkRoot,
      "repos",
      repoKey,
      "annotations",
      "data_items.yaml",
    );
    const raw = fs.readFileSync(dataItemsPath, "utf8");
    const parsed = YAML.parse(raw) as AnnotationFile;
    parsed.annotations = parsed.annotations.map((record) => {
      const entry = entriesById.get(record.id);
      if (!entry) {
        return record;
      }
      appliedCount += 1;
      return applyLedgerEntryToRecord(record, entry);
    });
    fs.writeFileSync(dataItemsPath, YAML.stringify(parsed, { lineWidth: 0 }), "utf8");
    console.log(`${repoKey}: checked ${parsed.annotations.length} rows`);
  }

  if (appliedCount !== ledger.totalRows) {
    throw new Error(`Expected to apply ${ledger.totalRows} rows, applied ${appliedCount}`);
  }

  const digest = digestCorpusGold(benchmarkRoot);
  fs.writeFileSync(
    CORPUS_GOLD_DIGEST_PIN,
    `# Pinned digest of all committed corpus gold YAML under tests/benchmark/repos/.\n${digest}\n`,
    "utf8",
  );
  console.log(`Updated corpus-gold digest pin: ${digest}`);
}

function printSummary(ledger: Slice2AdjudicationLedger): void {
  console.log(`Adjudication task: ${DATA_ITEM_ADJUDICATION_SLICE2_TASK}`);
  console.log(`Total rows: ${ledger.totalRows}`);
  console.log(`Dispositions:`, ledger.dispositions);
  console.log(`Label corrections: ${ledger.labelCorrectionCount}`);
  console.log(`Contested calls: ${ledger.contestedCount}`);
  console.log("By source bucket:");
  for (const [bucket, counts] of Object.entries(ledger.bySourceBucket).sort()) {
    console.log(`  ${bucket}:`, counts);
  }
}

function main(): void {
  const { values } = parseArgs({
    options: {
      "write-ledger": { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
    },
  });

  if (values.apply) {
    const ledger = loadLedger();
    applyLedgerToYaml(ledger, resolveDefaultBenchmarkRoot());
    printSummary(ledger);
    return;
  }

  const rows = listUnresolvedDataItemRows();
  const ledger = buildSlice2AdjudicationLedger(rows);

  if (ledger.totalRows !== 247) {
    throw new Error(`Expected 247 ledger entries, got ${ledger.totalRows}`);
  }

  const dispositionTotal =
    ledger.dispositions.accept + ledger.dispositions.reject + ledger.dispositions.unresolved;
  if (dispositionTotal !== 247) {
    throw new Error(`Disposition accounting mismatch: ${dispositionTotal} !== 247`);
  }

  printSummary(ledger);

  if (values["write-ledger"]) {
    writeLedger(ledger);
    console.log(`Wrote ${LEDGER_SHORT_PATH}`);
    return;
  }

  console.log("Dry run — pass --write-ledger to write adjudication-ledger.json.");
}

main();
