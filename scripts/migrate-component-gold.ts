#!/usr/bin/env node
/**
 * Mechanical migration of component gold to structured canonical identity (KDATAP-8aed54).
 *
 * Usage:
 *   npx ts-node scripts/migrate-component-gold.ts [--write]
 */

import * as fs from "fs";
import * as path from "path";

import { parseArgs } from "node:util";
import YAML from "yaml";

import { resolveDefaultBenchmarkRoot } from "../tests/benchmark/paths";
import type { AnnotationFile, AnnotationRecord } from "../tests/benchmark/schema";
import {
  buildAnnotationCanonicalBlock,
  buildComponentMigrationLedger,
  listAcceptedComponentAnnotations,
} from "../tests/eval/canonical/compat/component-migration";

const REPO_ROOT = path.join(__dirname, "..");
const LEDGER_PATH = path.join(REPO_ROOT, "annotations/KDATAP-8aed54/migration-ledger.json");

function writeLedger(ledger: ReturnType<typeof buildComponentMigrationLedger>): void {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function migrateComponentsYaml(
  repoKey: string,
  componentsPath: string,
): { updated: number; total: number } {
  const raw = fs.readFileSync(componentsPath, "utf8");
  const parsed = YAML.parse(raw) as AnnotationFile;
  let updated = 0;

  for (const record of parsed.annotations) {
    if (record.layer !== "components") {
      continue;
    }
    if (record.provenance.review_state !== "accepted") {
      continue;
    }
    record.canonical = buildAnnotationCanonicalBlock(repoKey, record);
    updated += 1;
  }

  fs.writeFileSync(componentsPath, YAML.stringify(parsed), "utf8");
  return { updated, total: parsed.annotations.length };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      write: { type: "boolean", default: false },
    },
  });

  const benchmarkRoot = resolveDefaultBenchmarkRoot();
  const ledger = buildComponentMigrationLedger(benchmarkRoot);
  writeLedger(ledger);

  console.log(
    `Migration ledger: ${ledger.totalRows} accepted component rows (mechanical=${ledger.buckets.mechanical}, vendor=${ledger.buckets.vendor}, actor_user_retarget=${ledger.buckets.actor_user_retarget})`,
  );
  console.log(`Wrote ${LEDGER_PATH}`);

  if (!values.write) {
    console.log("Dry run — pass --write to update components.yaml files.");
    return;
  }

  const rows = listAcceptedComponentAnnotations(benchmarkRoot);
  const byRepo = new Map<string, AnnotationRecord[]>();
  for (const { repoKey, record } of rows) {
    const group = byRepo.get(repoKey) ?? [];
    group.push(record);
    byRepo.set(repoKey, group);
  }

  for (const repoKey of [...byRepo.keys()].sort()) {
    const componentsPath = path.join(
      benchmarkRoot,
      "repos",
      repoKey,
      "annotations",
      "components.yaml",
    );
    const { updated } = migrateComponentsYaml(repoKey, componentsPath);
    console.log(`${repoKey}: wrote canonical block on ${updated} accepted rows`);
  }
}

main();
