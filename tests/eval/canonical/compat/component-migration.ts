import path from "path";

import type { AnnotationCanonical, AnnotationRecord } from "../../../benchmark/schema";
import { loadAnnotations } from "../../../benchmark/manifest";
import { resolveDefaultBenchmarkRoot } from "../../../benchmark/paths";
import { listBenchmarkRepoKeys } from "../../../benchmark/run-benchmark";
import { annotationRecordToLegacyInput } from "./adapters";
import {
  buildRepoLocalEntityId,
  classificationIdentityKey,
  resolveComponentSubtype,
} from "./component-taxonomy";
import { loadLegacyGoldRecord } from "./loader";
import type { CanonicalDisposition } from "../../../../src/eval/canonical/types";

export type ComponentMigrationBucket =
  | "mechanical"
  | "vendor"
  | "actor_user_retarget";

export interface ComponentMigrationLedgerEntry {
  annotationId: string;
  repoKey: string;
  bucket: ComponentMigrationBucket;
  entityId: string;
  identityKey: string;
  componentType: string;
  componentSubtype: string;
  vendor?: string;
  legacySubjectKey: string;
  disposition: CanonicalDisposition;
}

export interface ComponentMigrationLedger {
  task: "KDATAP-8aed54";
  totalRows: number;
  buckets: Record<ComponentMigrationBucket, number>;
  entries: ComponentMigrationLedgerEntry[];
}

const ACTOR_USER_MIGRATION_IDS = new Set([
  "auth0-express-customer-actor",
  "directus-admin-actor",
  "directus-user-type",
  "discourse-user-actor",
  "drupal-user-actor",
  "easy-school-student-actor",
  "flask-login-customer-actor",
  "gitea-user-actor",
  "hyperswitch-merchant-customer-actor",
  "keycloak-user-actor",
  "magento-customer-actor",
  "medusa-customer-user-actor",
  "nopcommerce-customer-actor",
  "orchard-user-actor",
  "orchard-iuser-abstraction",
  "pocketbase-customer-actor",
  "posthog-user-actor",
  "redmine-employee-actor",
  "redmine-anonymous-user-actor",
  "redmine-group-actor",
  "saleor-customer-actor",
  "spree-customer-actor",
  "spring-petclinic-customer-actor",
  "strapi-admin-actor",
  "strapi-admin-user-content-type",
  "supabase-js-customer-actor",
  "vapor-customer-actor",
  "wordpress-wp-user-actor",
  "wordpress-comment-actor",
  "yjdh-employee-actor",
]);

function parseKeyPrefix(key: string): { prefix: string; rest: string } {
  const separator = key.indexOf(":");
  if (separator === -1) {
    return { prefix: "", rest: key.trim().toLowerCase() };
  }
  return {
    prefix: key.slice(0, separator).trim().toLowerCase(),
    rest: key.slice(separator + 1).trim().toLowerCase(),
  };
}

export function classifyComponentMigrationBucket(
  record: AnnotationRecord,
): ComponentMigrationBucket {
  const legacyKey = record.subject.key.trim();
  const { prefix } = parseKeyPrefix(legacyKey);
  if (prefix === "third_party") {
    return "vendor";
  }
  if (ACTOR_USER_MIGRATION_IDS.has(record.id)) {
    return "actor_user_retarget";
  }
  return "mechanical";
}

export function buildAnnotationCanonicalBlock(
  repoKey: string,
  record: AnnotationRecord,
): AnnotationCanonical {
  const legacyKey = record.subject.key.trim();
  const { prefix, rest } = parseKeyPrefix(legacyKey);
  const componentType = prefix;
  const componentSubtype = resolveComponentSubtype(
    componentType,
    record.expected.labels,
    rest,
  );
  const identityKey = classificationIdentityKey(componentType, componentSubtype);
  const entityId = buildRepoLocalEntityId(repoKey, record.id);

  const block: AnnotationCanonical = {
    entity_id: entityId,
    identity_key: identityKey,
    component_type: componentType,
    component_subtype: componentSubtype,
  };

  if (componentType === "third_party") {
    block.vendor = rest;
  }

  return block;
}

export function buildComponentMigrationLedgerEntry(
  repoKey: string,
  record: AnnotationRecord,
): ComponentMigrationLedgerEntry {
  const canonical = buildAnnotationCanonicalBlock(repoKey, record);
  const { record: goldRecord } = loadLegacyGoldRecord(
    {
      ...annotationRecordToLegacyInput(record),
      canonical,
    },
    { warn: () => undefined, repoKey },
  );

  return {
    annotationId: record.id,
    repoKey,
    bucket: classifyComponentMigrationBucket(record),
    entityId: canonical.entity_id,
    identityKey: canonical.identity_key,
    componentType: canonical.component_type,
    componentSubtype: canonical.component_subtype,
    vendor: canonical.vendor,
    legacySubjectKey: record.subject.key.trim(),
    disposition: goldRecord.disposition,
  };
}

export function buildComponentMigrationLedger(
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): ComponentMigrationLedger {
  const repoKeys = listBenchmarkRepoKeys(benchmarkRoot);
  const entries: ComponentMigrationLedgerEntry[] = [];
  const buckets: Record<ComponentMigrationBucket, number> = {
    mechanical: 0,
    vendor: 0,
    actor_user_retarget: 0,
  };

  for (const repoKey of repoKeys) {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const annotations = loadAnnotations(repoDir, "components");
    for (const record of annotations) {
      if (record.provenance.review_state !== "accepted") {
        continue;
      }
      const entry = buildComponentMigrationLedgerEntry(repoKey, record);
      entries.push(entry);
      buckets[entry.bucket] += 1;
    }
  }

  return {
    task: "KDATAP-8aed54",
    totalRows: entries.length,
    buckets,
    entries,
  };
}

export function listAcceptedComponentAnnotations(
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): Array<{ repoKey: string; record: AnnotationRecord }> {
  const repoKeys = listBenchmarkRepoKeys(benchmarkRoot);
  const rows: Array<{ repoKey: string; record: AnnotationRecord }> = [];

  for (const repoKey of repoKeys) {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const annotations = loadAnnotations(repoDir, "components");
    for (const record of annotations) {
      if (record.provenance.review_state !== "accepted") {
        continue;
      }
      rows.push({ repoKey, record });
    }
  }

  return rows;
}
