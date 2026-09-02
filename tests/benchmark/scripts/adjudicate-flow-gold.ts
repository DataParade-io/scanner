#!/usr/bin/env node
/**
 * Deterministic flow adjudication pass (KDATAP-47e331).
 *
 *   pnpm exec ts-node tests/benchmark/scripts/adjudicate-flow-gold.ts
 *   pnpm exec ts-node tests/benchmark/scripts/adjudicate-flow-gold.ts --write-ledger
 *   pnpm exec ts-node tests/benchmark/scripts/adjudicate-flow-gold.ts --apply
 */
import fs from "fs";
import path from "path";

import { parseArgs } from "node:util";
import YAML from "yaml";

import { digestCorpusGold } from "../baseline/digests";
import { resolveDefaultBenchmarkRoot } from "../paths";
import type { AnnotationFile, AnnotationRecord } from "../schema";
import {
  assertFlowAcceptCeiling,
  buildFlowAdjudicationLedger,
  FLOW_ADJUDICATION_TASK,
  type FlowAdjudicationLedger,
  type FlowAdjudicationLedgerEntry,
} from "../../eval/canonical/compat/flow-adjudication";
import { listAllDataFlowAnnotations } from "../../eval/canonical/compat/flow-migration";

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const LEDGER_SHORT_PATH = path.join(
  REPO_ROOT,
  "annotations/KDATAP-47e331/adjudication-ledger.json",
);

const CORPUS_GOLD_DIGEST_PIN = path.join(
  REPO_ROOT,
  "tests/fixtures/baseline/pins/corpus-gold.digest",
);

function writeLedger(ledger: FlowAdjudicationLedger): void {
  fs.mkdirSync(path.dirname(LEDGER_SHORT_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_SHORT_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function loadLedger(): FlowAdjudicationLedger {
  if (!fs.existsSync(LEDGER_SHORT_PATH)) {
    throw new Error(`Missing adjudication ledger at ${LEDGER_SHORT_PATH}`);
  }
  return JSON.parse(fs.readFileSync(LEDGER_SHORT_PATH, "utf8")) as FlowAdjudicationLedger;
}

function applyLedgerEntryToRecord(
  record: AnnotationRecord,
  entry: FlowAdjudicationLedgerEntry,
): AnnotationRecord {
  const updated: AnnotationRecord = {
    ...record,
    provenance: { ...record.provenance },
    expected: { ...record.expected, labels: [...record.expected.labels] },
  };

  if (entry.disposition === "accept" && entry.candidate) {
    updated.provenance.review_state = "accepted";
    updated.candidate = entry.candidate;
  } else if (entry.disposition === "reject") {
    updated.provenance.review_state = "rejected";
    delete updated.candidate;
  } else {
    updated.provenance.review_state = "needs_adjudication";
    delete updated.candidate;
  }

  return updated;
}

function applyLedgerToYaml(ledger: FlowAdjudicationLedger, benchmarkRoot: string): void {
  const entriesById = new Map(ledger.entries.map((entry) => [entry.annotationId, entry]));
  const rows = listAllDataFlowAnnotations(benchmarkRoot);
  const byRepo = new Map<string, AnnotationRecord[]>();
  for (const { repoKey, record } of rows) {
    const group = byRepo.get(repoKey) ?? [];
    group.push(record);
    byRepo.set(repoKey, group);
  }

  for (const repoKey of [...byRepo.keys()].sort()) {
    const flowsPath = path.join(
      benchmarkRoot,
      "repos",
      repoKey,
      "annotations",
      "data_flows.yaml",
    );
    const raw = fs.readFileSync(flowsPath, "utf8");
    const parsed = YAML.parse(raw) as AnnotationFile;
    parsed.annotations = parsed.annotations.map((record) => {
      const entry = entriesById.get(record.id);
      if (!entry) {
        throw new Error(`Missing ledger entry for ${repoKey}::${record.id}`);
      }
      return applyLedgerEntryToRecord(record, entry);
    });
    fs.writeFileSync(flowsPath, YAML.stringify(parsed, { lineWidth: 0 }), "utf8");
    console.log(`${repoKey}: applied ${parsed.annotations.length} rows`);
  }

  const digest = digestCorpusGold(benchmarkRoot);
  fs.writeFileSync(
    CORPUS_GOLD_DIGEST_PIN,
    `# Pinned digest of all committed corpus gold YAML under tests/benchmark/repos/.\n${digest}\n`,
    "utf8",
  );
  console.log(`Updated corpus-gold digest pin: ${digest}`);
}

function printSummary(ledger: FlowAdjudicationLedger): void {
  console.log(`Adjudication task: ${FLOW_ADJUDICATION_TASK}`);
  console.log(`Total rows: ${ledger.totalRows}`);
  console.log(`Dispositions:`, ledger.dispositions);
  console.log(`Accept ceiling: ${ledger.acceptCeiling}`);
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

  const benchmarkRoot = resolveDefaultBenchmarkRoot();

  if (values.apply) {
    const ledger = loadLedger();
    assertFlowAcceptCeiling(ledger);
    applyLedgerToYaml(ledger, benchmarkRoot);
    return;
  }

  const ledger = buildFlowAdjudicationLedger(undefined, benchmarkRoot);
  assertFlowAcceptCeiling(ledger);
  printSummary(ledger);

  if (ledger.totalRows !== 436) {
    throw new Error(`Expected 436 ledger entries, got ${ledger.totalRows}`);
  }

  if (values["write-ledger"]) {
    writeLedger(ledger);
    console.log(`Wrote ${LEDGER_SHORT_PATH}`);
    return;
  }

  console.log("Dry run — pass --write-ledger to write adjudication-ledger.json.");
}

main();
