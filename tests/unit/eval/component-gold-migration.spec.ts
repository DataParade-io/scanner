import path from "path";

import { listBenchmarkRepoKeys } from "../../benchmark/run-benchmark";
import { loadAnnotations } from "../../benchmark/manifest";
import {
  buildComponentMigrationLedger,
  loadLegacyGoldRecord,
  annotationRecordToLegacyInput,
  type ComponentMigrationLedgerEntry,
} from "../../eval/canonical";

const ACTOR_USER_MIGRATION_IDS = [
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
] as const;

describe("component gold structured identity migration (KDATAP-8aed54)", () => {
  const benchmarkRoot = path.join(__dirname, "../../benchmark");
  const ledger = buildComponentMigrationLedger(benchmarkRoot);

  it("accounts for all 519 accepted component rows (KDATAP-b702ea: 44 negative decoys demoted)", () => {
    expect(ledger.totalRows).toBe(519);
    expect(ledger.buckets.mechanical).toBe(473);
    expect(ledger.buckets.vendor).toBe(16);
    expect(ledger.buckets.actor_user_retarget).toBe(30);
    expect(
      ledger.buckets.mechanical + ledger.buckets.vendor + ledger.buckets.actor_user_retarget,
    ).toBe(519);
  });

  it("assigns distinct entityIds and shared identityKey for discourse asset:database", () => {
    const discourseRows = ledger.entries.filter(
      (entry: ComponentMigrationLedgerEntry) =>
        entry.repoKey === "discourse" && entry.legacySubjectKey === "asset:database",
    );

    expect(discourseRows).toHaveLength(118);
    expect(new Set(discourseRows.map((row: ComponentMigrationLedgerEntry) => row.identityKey))).toEqual(
      new Set(["asset:database"]),
    );
    expect(new Set(discourseRows.map((row: ComponentMigrationLedgerEntry) => row.entityId)).size).toBe(118);
  });

  it("never invents optionalAssertion.instance on migrated gold", () => {
    for (const repoKey of listBenchmarkRepoKeys(benchmarkRoot)) {
      const repoDir = path.join(benchmarkRoot, "repos", repoKey);
      const annotations = loadAnnotations(repoDir, "components");
      for (const annotation of annotations) {
        if (annotation.provenance.review_state !== "accepted") {
          continue;
        }
        const { record } = loadLegacyGoldRecord(annotationRecordToLegacyInput(annotation), {
          warn: () => undefined,
          repoKey,
        });
        expect(record.optionalAssertion?.instance).toBeUndefined();
      }
    }
  });

  it("asserts vendor on exactly 16 third_party rows (KDATAP-b702ea: 36 negative vendor decoys demoted)", () => {
    const vendorRows = ledger.entries.filter(
      (entry: ComponentMigrationLedgerEntry) => entry.bucket === "vendor",
    );
    expect(vendorRows).toHaveLength(16);
    for (const row of vendorRows) {
      expect(row.vendor).toBeTruthy();
      expect(row.identityKey).toMatch(/^third_party:/);
      expect(row.identityKey).not.toBe(`third_party:${row.vendor}`);
    }
  });

  it("maps third_party:checkr to saas_service subtype with vendor checkr", () => {
    const checkr = ledger.entries.find(
      (entry: ComponentMigrationLedgerEntry) => entry.annotationId === "vgs-django-third-party-checkr",
    );
    expect(checkr).toBeDefined();
    expect(checkr!.identityKey).toBe("third_party:saas_service");
    expect(checkr!.vendor).toBe("checkr");
    expect(checkr!.entityId).toBe("vgs-django::vgs-django-third-party-checkr");
  });

  it("does not use actor:user anywhere in corpus component gold", () => {
    const actorUser = ledger.entries.filter(
      (entry: ComponentMigrationLedgerEntry) => entry.legacySubjectKey === "actor:user",
    );
    expect(actorUser).toHaveLength(0);
  });

  it("covers every actor_user_retarget id from PR #17", () => {
    const retargeted = new Set(
      ledger.entries
        .filter((entry: ComponentMigrationLedgerEntry) => entry.bucket === "actor_user_retarget")
        .map((entry: ComponentMigrationLedgerEntry) => entry.annotationId),
    );
    for (const id of ACTOR_USER_MIGRATION_IDS) {
      expect(retargeted.has(id)).toBe(true);
    }
    expect(retargeted.size).toBe(ACTOR_USER_MIGRATION_IDS.length);
  });

  it("persists canonical.entity_id on every accepted component annotation", () => {
    for (const repoKey of listBenchmarkRepoKeys(benchmarkRoot)) {
      const repoDir = path.join(benchmarkRoot, "repos", repoKey);
      const annotations = loadAnnotations(repoDir, "components");
      for (const annotation of annotations) {
        if (annotation.provenance.review_state !== "accepted") {
          continue;
        }
        expect(annotation.canonical?.entity_id).toBe(`${repoKey}::${annotation.id}`);
        expect(annotation.canonical?.identity_key).toBeTruthy();
      }
    }
  });
});
