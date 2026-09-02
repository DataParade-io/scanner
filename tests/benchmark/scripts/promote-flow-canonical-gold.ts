#!/usr/bin/env node
/**
 * Promote adjudicated accepted flows to flow_canonical blocks (KDATAP-7e5b94).
 *
 *   pnpm exec ts-node tests/benchmark/scripts/promote-flow-canonical-gold.ts
 *   pnpm exec ts-node tests/benchmark/scripts/promote-flow-canonical-gold.ts --write
 */
import fs from "fs";
import path from "path";

import { parseArgs } from "node:util";
import YAML from "yaml";

import { digestCorpusGold } from "../baseline/digests";
import { resolveDefaultBenchmarkRoot } from "../paths";
import type { AnnotationFile, AnnotationRecord } from "../schema";
import { listBenchmarkRepoKeys } from "../run-benchmark";
import {
  buildComponentEntityIndex,
  buildFlowAnnotationCanonicalBlock,
  FLOW_CANONICAL_PROMOTION_TASK,
  listAcceptedComponentsWithCanonical,
} from "../../eval/canonical/compat/flow-migration";
import type { FlowAdjudicationLedgerEntry } from "../../eval/canonical/compat/flow-adjudication";
import { loadLegacyGoldRecord } from "../../eval/canonical/compat/loader";
import { annotationRecordToLegacyInput } from "../../eval/canonical/compat/adapters";

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const ADJUDICATION_LEDGER_PATH = path.join(
  REPO_ROOT,
  "annotations/KDATAP-47e331/adjudication-ledger.json",
);
const FLYWHEEL_DIR = path.join(REPO_ROOT, "annotations", FLOW_CANONICAL_PROMOTION_TASK);
const LEDGER_PATH = path.join(FLYWHEEL_DIR, "migration-ledger.json");
const PASS_PATH = path.join(FLYWHEEL_DIR, "pass.md");
const CORPUS_GOLD_DIGEST_PIN = path.join(
  REPO_ROOT,
  "tests/fixtures/baseline/pins/corpus-gold.digest",
);

interface AdjudicationLedger {
  entries: FlowAdjudicationLedgerEntry[];
}

export interface FlowCanonicalPromotionLedgerEntry {
  annotationId: string;
  repoKey: string;
  identityKey: string;
  dispositionCandidate: string;
  sourceEntityId: string;
  targetEntityId: string;
  loaderDispositionBefore: string;
  loaderDispositionAfter: string;
}

export interface FlowCanonicalPromotionLedger {
  task: typeof FLOW_CANONICAL_PROMOTION_TASK;
  promotedAt: string;
  totalAcceptRows: number;
  entries: FlowCanonicalPromotionLedgerEntry[];
}

function loadAdjudicationLedger(): AdjudicationLedger {
  if (!fs.existsSync(ADJUDICATION_LEDGER_PATH)) {
    throw new Error(`Missing adjudication ledger at ${ADJUDICATION_LEDGER_PATH}`);
  }
  return JSON.parse(fs.readFileSync(ADJUDICATION_LEDGER_PATH, "utf8")) as AdjudicationLedger;
}

function promoteFlowRecord(
  record: AnnotationRecord,
  entry: FlowAdjudicationLedgerEntry,
  componentIndex: Map<string, AnnotationRecord>,
  repoKey: string,
): { record: AnnotationRecord; ledgerEntry: FlowCanonicalPromotionLedgerEntry } {
  if (record.provenance.review_state !== "accepted") {
    throw new Error(`${record.id}: expected review_state accepted, got ${record.provenance.review_state}`);
  }
  if (!entry.sourceEntityId || !entry.targetEntityId) {
    throw new Error(`${record.id}: adjudication accept row missing source/target entity ids`);
  }

  const dispositionCandidate =
    entry.finalDispositionCandidate ??
    entry.candidate?.disposition_candidate ??
    "intra_component_lineage";

  const before = loadLegacyGoldRecord(annotationRecordToLegacyInput(record), {
    repoKey,
    warn: () => undefined,
  });

  const flowCanonical = buildFlowAnnotationCanonicalBlock(
    entry.sourceEntityId,
    entry.targetEntityId,
    dispositionCandidate,
    componentIndex,
    {
      flowType: entry.candidate?.proposed_flow_type ?? entry.proposedFlowType,
      dataCategories: entry.candidate?.proposed_data_categories ?? entry.proposedDataCategories,
    },
  );

  const promoted: AnnotationRecord = {
    ...record,
    flow_canonical: flowCanonical,
  };

  const after = loadLegacyGoldRecord(annotationRecordToLegacyInput(promoted), {
    repoKey,
    warn: () => undefined,
  });

  return {
    record: promoted,
    ledgerEntry: {
      annotationId: record.id,
      repoKey,
      identityKey: flowCanonical.identity_key,
      dispositionCandidate,
      sourceEntityId: entry.sourceEntityId,
      targetEntityId: entry.targetEntityId,
      loaderDispositionBefore: before.record.disposition,
      loaderDispositionAfter: after.record.disposition,
    },
  };
}

function buildPromotionLedger(benchmarkRoot: string): FlowCanonicalPromotionLedger {
  const adjudication = loadAdjudicationLedger();
  const acceptEntries = adjudication.entries.filter((entry) => entry.disposition === "accept");
  const promotionEntries: FlowCanonicalPromotionLedgerEntry[] = [];

  for (const entry of acceptEntries) {
    const repoDir = path.join(benchmarkRoot, "repos", entry.repoKey);
    const flowsPath = path.join(repoDir, "annotations", "data_flows.yaml");
    const raw = fs.readFileSync(flowsPath, "utf8");
    const parsed = YAML.parse(raw) as AnnotationFile;
    const record = parsed.annotations.find((row) => row.id === entry.annotationId);
    if (!record) {
      throw new Error(`Missing flow annotation ${entry.repoKey}::${entry.annotationId}`);
    }

    const components = listAcceptedComponentsWithCanonical(repoDir);
    const componentIndex = buildComponentEntityIndex(components);
    const { ledgerEntry } = promoteFlowRecord(record, entry, componentIndex, entry.repoKey);
    promotionEntries.push(ledgerEntry);
  }

  return {
    task: FLOW_CANONICAL_PROMOTION_TASK,
    promotedAt: new Date().toISOString(),
    totalAcceptRows: promotionEntries.length,
    entries: promotionEntries,
  };
}

function writeFlywheel(ledger: FlowCanonicalPromotionLedger, digestAfter?: string): void {
  fs.mkdirSync(FLYWHEEL_DIR, { recursive: true });
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

  const acceptedAfter = ledger.entries.filter(
    (entry) => entry.loaderDispositionAfter === "accepted",
  ).length;

  const pass = `# Annotation pass

## Task

${FLOW_CANONICAL_PROMOTION_TASK} — Promote accepted flows to canonical blocks with typed endpoints.

Parent: KDATAP-baca471 (corpus gold migration readiness).

## Scope

146 adjudicated accept rows across 29 \`data_flows.yaml\` packets.

## Method

Mechanical script \`tests/benchmark/scripts/promote-flow-canonical-gold.ts\`:

1. Read \`annotations/KDATAP-47e331/adjudication-ledger.json\` accept rows
2. Synthesize typed endpoints from accepted component \`canonical\` blocks via entity ids
3. Write \`flow_canonical\` on each row; preserve \`review_state\`, \`candidate\`, legacy \`subject.key\`
4. Recompute \`corpus-gold.digest\` on \`--write\`

## Counts

| Metric | Value |
| --- | ---: |
| Accept rows promoted | ${ledger.totalAcceptRows} |
| Loader disposition accepted after | ${acceptedAfter} |

Ledger: \`annotations/${FLOW_CANONICAL_PROMOTION_TASK}/migration-ledger.json\`.

## Inversion table

| Dimension | Before | After |
| --- | --- | --- |
| Accepted flows with \`flow_canonical\` | 0 | ${ledger.totalAcceptRows} |
| Canonical loader accepts (data-flows) | 0 | ${acceptedAfter} |
| \`LOADER_EXEMPTION\` (data-flows) | 146 | 0 |
| \`FLOW_NO_CANONICAL_ACCEPTS\` | 3 | 0 |

${digestAfter ? `Digest after: \`${digestAfter}\`` : "Digest unchanged (dry run)."}
`;
  fs.writeFileSync(PASS_PATH, pass, "utf8");
}

function applyPromotion(benchmarkRoot: string, ledger: FlowCanonicalPromotionLedger): string {
  const adjudication = loadAdjudicationLedger();
  const acceptById = new Map(
    adjudication.entries
      .filter((entry) => entry.disposition === "accept")
      .map((entry) => [entry.annotationId, entry]),
  );

  for (const repoKey of listBenchmarkRepoKeys(benchmarkRoot)) {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const flowsPath = path.join(repoDir, "annotations", "data_flows.yaml");
    const manifestPath = path.join(repoDir, "manifest.yaml");
    const raw = fs.readFileSync(flowsPath, "utf8");
    const parsed = YAML.parse(raw) as AnnotationFile;
    const components = listAcceptedComponentsWithCanonical(repoDir);
    const componentIndex = buildComponentEntityIndex(components);

    let updated = 0;
    parsed.annotations = parsed.annotations.map((record) => {
      const entry = acceptById.get(record.id);
      if (!entry || entry.repoKey !== repoKey) {
        return record;
      }
      const { record: promoted } = promoteFlowRecord(record, entry, componentIndex, repoKey);
      updated += 1;
      return promoted;
    });

    if (updated > 0) {
      fs.writeFileSync(flowsPath, YAML.stringify(parsed, { lineWidth: 0 }), "utf8");
      const manifest = YAML.parse(fs.readFileSync(manifestPath, "utf8")) as {
        annotation_version: number;
      };
      manifest.annotation_version += 1;
      fs.writeFileSync(manifestPath, YAML.stringify(manifest, { lineWidth: 0 }), "utf8");
    }

    console.log(`${repoKey}: wrote flow_canonical on ${updated} accepted rows`);
  }

  const digest = digestCorpusGold(benchmarkRoot);
  fs.writeFileSync(
    CORPUS_GOLD_DIGEST_PIN,
    `# Pinned digest of all committed corpus gold YAML under tests/benchmark/repos/.\n${digest}\n`,
    "utf8",
  );
  console.log(`Updated corpus-gold digest pin: ${digest}`);
  return digest;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      write: { type: "boolean", default: false },
    },
  });

  const benchmarkRoot = resolveDefaultBenchmarkRoot();
  const ledger = buildPromotionLedger(benchmarkRoot);

  if (ledger.totalAcceptRows !== 146) {
    throw new Error(`Expected 146 accept rows, found ${ledger.totalAcceptRows}`);
  }

  const notAccepted = ledger.entries.filter((entry) => entry.loaderDispositionAfter !== "accepted");
  if (notAccepted.length > 0) {
    throw new Error(
      `Loader did not accept ${notAccepted.length} rows: ${notAccepted
        .slice(0, 3)
        .map((entry) => entry.annotationId)
        .join(", ")}`,
    );
  }

  writeFlywheel(ledger);
  console.log(`Promotion ledger: ${ledger.totalAcceptRows} rows`);
  console.log(`Wrote ${LEDGER_PATH}`);

  if (!values.write) {
    console.log("Dry run — pass --write to update data_flows.yaml files.");
    return;
  }

  const digest = applyPromotion(benchmarkRoot, ledger);
  writeFlywheel(ledger, digest);
}

main();
