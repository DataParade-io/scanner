#!/usr/bin/env node
/**
 * Slice-2 flow adjudication (KDATAP-a7c36b) — remaining needs_adjudication rows.
 *
 *   pnpm exec ts-node tests/benchmark/scripts/adjudicate-flow-gold-slice2.ts
 *   pnpm exec ts-node tests/benchmark/scripts/adjudicate-flow-gold-slice2.ts --write-ledger
 *   pnpm exec ts-node tests/benchmark/scripts/adjudicate-flow-gold-slice2.ts --apply
 *
 * --apply (manager-authorized only, after human packet accept):
 *   1. Flip review_state + candidate on slice-2 rows only
 *   2. Write flow_canonical via buildFlowAnnotationCanonicalBlock on every accept
 *   3. Recompute corpus-gold.digest from the clean committed tree
 *   4. Sync Kanbus finding statuses (accepted / rejected / proposed) for this slice
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

import { parseArgs } from "node:util";
import YAML from "yaml";

import { digestCorpusGold } from "../baseline/digests";
import { resolveDefaultBenchmarkRoot } from "../paths";
import type { AnnotationFile, AnnotationRecord } from "../schema";
import type { FlowAdjudicationLedgerEntry } from "../../eval/canonical/compat/flow-adjudication";
import {
  buildSlice2FlowAdjudicationLedger,
  FLOW_ADJUDICATION_SLICE2_TASK,
  listUnresolvedFlowRows,
  type Slice2FlowAdjudicationLedger,
} from "../../eval/canonical/compat/flow-adjudication-slice2";
import {
  buildComponentEntityIndex,
  buildFlowAnnotationCanonicalBlock,
  listAcceptedComponentsWithCanonical,
  listAllDataFlowAnnotations,
} from "../../eval/canonical/compat/flow-migration";

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const LEDGER_SHORT_PATH = path.join(
  REPO_ROOT,
  "annotations/KDATAP-a7c36b/adjudication-ledger.json",
);
const CORPUS_GOLD_DIGEST_PIN = path.join(
  REPO_ROOT,
  "tests/fixtures/baseline/pins/corpus-gold.digest",
);

function writeLedger(ledger: Slice2FlowAdjudicationLedger): void {
  fs.mkdirSync(path.dirname(LEDGER_SHORT_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_SHORT_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function loadLedger(): Slice2FlowAdjudicationLedger {
  if (!fs.existsSync(LEDGER_SHORT_PATH)) {
    throw new Error(`Missing adjudication ledger at ${LEDGER_SHORT_PATH}`);
  }
  return JSON.parse(fs.readFileSync(LEDGER_SHORT_PATH, "utf8")) as Slice2FlowAdjudicationLedger;
}

function applyLedgerEntryToRecord(
  record: AnnotationRecord,
  entry: FlowAdjudicationLedgerEntry,
  componentIndex: Map<string, AnnotationRecord>,
): AnnotationRecord {
  const updated: AnnotationRecord = {
    ...record,
    provenance: { ...record.provenance },
    expected: { ...record.expected, labels: [...record.expected.labels] },
  };

  if (entry.disposition === "accept" && entry.candidate) {
    if (!entry.sourceEntityId || !entry.targetEntityId) {
      throw new Error(`${record.id}: accept row missing source/target entity ids`);
    }
    const dataCategories = entry.candidate.proposed_data_categories ?? entry.proposedDataCategories;
    if (!dataCategories?.length) {
      throw new Error(`${record.id}: accept row missing closed concept-map data_categories`);
    }
    const dispositionCandidate =
      entry.finalDispositionCandidate ?? entry.candidate.disposition_candidate;
    const flowCanonical = buildFlowAnnotationCanonicalBlock(
      entry.sourceEntityId,
      entry.targetEntityId,
      dispositionCandidate,
      componentIndex,
      {
        flowType: entry.candidate.proposed_flow_type ?? entry.proposedFlowType,
        dataCategories: entry.candidate.proposed_data_categories ?? entry.proposedDataCategories,
      },
    );
    updated.provenance.review_state = "accepted";
    updated.candidate = entry.candidate;
    updated.flow_canonical = flowCanonical;
  } else if (entry.disposition === "reject") {
    updated.provenance.review_state = "rejected";
    delete updated.candidate;
    delete updated.flow_canonical;
  } else {
    updated.provenance.review_state = "needs_adjudication";
    delete updated.candidate;
    delete updated.flow_canonical;
  }

  return updated;
}

const KANBUS_FINDING_PARENT = "b0d5e2";

function loadFindingTitlesToIds(): Map<string, string> {
  const output = execSync(`kbs list --type finding --parent ${KANBUS_FINDING_PARENT} --porcelain`, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const map = new Map<string, string>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split("|").map((part) => part.trim());
    if (parts.length < 6) {
      continue;
    }
    const findingId = parts[1];
    const title = parts.slice(5).join("|").trim();
    map.set(title, findingId);
  }
  return map;
}

function syncKanbusFindingStatuses(ledger: Slice2FlowAdjudicationLedger): void {
  const findingIndex = loadFindingTitlesToIds();
  const statusByDisposition: Record<string, string> = {
    accept: "accepted",
    reject: "rejected",
  };

  for (const entry of ledger.entries) {
    if (entry.disposition === "unresolved") {
      continue;
    }
    const title = `Data flow: ${entry.annotationId}`;
    const findingId = findingIndex.get(title);
    if (!findingId) {
      throw new Error(`Kanbus finding not found for title: ${title}`);
    }
    const status = statusByDisposition[entry.disposition];
    execSync(`kbs update ${findingId} --status ${status}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "inherit"],
    });
    console.log(`Kanbus sync: ${findingId} (${title}) -> ${status}`);
  }
}

function applyLedgerToYaml(ledger: Slice2FlowAdjudicationLedger, benchmarkRoot: string): void {
  const entriesById = new Map(ledger.entries.map((entry) => [entry.annotationId, entry]));
  const rows = listAllDataFlowAnnotations(benchmarkRoot);
  const byRepo = new Map<string, AnnotationRecord[]>();
  for (const { repoKey, record } of rows) {
    const group = byRepo.get(repoKey) ?? [];
    group.push(record);
    byRepo.set(repoKey, group);
  }

  let appliedCount = 0;
  for (const repoKey of [...byRepo.keys()].sort()) {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const componentIndex = buildComponentEntityIndex(listAcceptedComponentsWithCanonical(repoDir));
    const flowsPath = path.join(repoDir, "annotations", "data_flows.yaml");
    const raw = fs.readFileSync(flowsPath, "utf8");
    const parsed = YAML.parse(raw) as AnnotationFile;
    parsed.annotations = parsed.annotations.map((record) => {
      const entry = entriesById.get(record.id);
      if (!entry) {
        return record;
      }
      appliedCount += 1;
      return applyLedgerEntryToRecord(record, entry, componentIndex);
    });
    fs.writeFileSync(flowsPath, YAML.stringify(parsed, { lineWidth: 0 }), "utf8");
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
  syncKanbusFindingStatuses(ledger);
}

function printSummary(ledger: Slice2FlowAdjudicationLedger): void {
  console.log(`Adjudication task: ${FLOW_ADJUDICATION_SLICE2_TASK}`);
  console.log(`Total rows: ${ledger.totalRows}`);
  console.log(`Dispositions:`, ledger.dispositions);
  console.log(`Category corrections: ${ledger.categoryCorrectionCount}`);
  console.log(`Demoted accepts: ${ledger.demotedAcceptCount}`);
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

  const rows = listUnresolvedFlowRows();
  const ledger = buildSlice2FlowAdjudicationLedger(rows);

  if (ledger.totalRows !== 273) {
    throw new Error(`Expected 273 ledger entries, got ${ledger.totalRows}`);
  }

  const dispositionTotal =
    ledger.dispositions.accept + ledger.dispositions.reject + ledger.dispositions.unresolved;
  if (dispositionTotal !== 273) {
    throw new Error(`Disposition accounting mismatch: ${dispositionTotal} !== 273`);
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
