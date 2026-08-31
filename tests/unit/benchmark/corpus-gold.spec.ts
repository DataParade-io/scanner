import * as fs from "fs";
import path from "path";
import YAML from "yaml";

import { loadAnnotations, loadBenchmarkManifest, loadLayerScopes } from "../../benchmark/manifest";
import { listBenchmarkRepoKeys } from "../../benchmark/run-benchmark";
import { annotationsToEvalCases } from "../../benchmark/to-eval-cases";

const PATTERNS_ROOT = path.join(__dirname, "../../../patterns");
const TAXONOMY_PATH = path.join(PATTERNS_ROOT, "component-taxonomy.yaml");

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

const ALLOWED_ACTOR_LABELS = new Set(["customer", "admin", "employee"]);

function loadActorSubtypeIds(): Set<string> {
  const raw = fs.readFileSync(TAXONOMY_PATH, "utf8");
  const parsed = YAML.parse(raw) as {
    subtypes: { id: string; type: string }[];
  };
  return new Set(
    parsed.subtypes.filter((subtype) => subtype.type === "actor").map((subtype) => subtype.id),
  );
}

describe("imported corpus gold", () => {
  const repoKeys = listBenchmarkRepoKeys();
  const benchmarkRoot = path.join(__dirname, "../../benchmark");

  it("ships 29 pinned packets", () => {
    expect(repoKeys).toHaveLength(29);
  });

  it("loads accepted annotations for every declared layer", () => {
    let accepted = 0;

    for (const repoKey of repoKeys) {
      const repoDir = path.join(benchmarkRoot, "repos", repoKey);
      const manifest = loadBenchmarkManifest(repoDir);
      expect(manifest.commit).toMatch(/^[a-f0-9]{40}$/);

      for (const layer of manifest.coverage.layers) {
        const annotations = loadAnnotations(repoDir, layer);
        const cases = annotationsToEvalCases(annotations, repoKey);
        accepted += cases.length;
        expect(annotations.length).toBeGreaterThan(0);
      }
    }

    expect(accepted).toBeGreaterThan(1000);
  });

  it("does not store exhaustive_scope_files on annotations (KDATAP-f9bb0f)", () => {
    const violations: string[] = [];

    for (const repoKey of repoKeys) {
      const repoDir = path.join(benchmarkRoot, "repos", repoKey);
      const annotationsDir = path.join(repoDir, "annotations");
      for (const fileName of fs.readdirSync(annotationsDir)) {
        if (!fileName.endsWith(".yaml")) {
          continue;
        }
        const text = fs.readFileSync(path.join(annotationsDir, fileName), "utf8");
        if (text.includes("exhaustive_scope_files")) {
          violations.push(`${repoKey}/${fileName}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("stores reviewed precision scope in layer-scopes.yaml (KDATAP-f9bb0f)", () => {
    let scopedPackets = 0;

    for (const repoKey of repoKeys) {
      const repoDir = path.join(benchmarkRoot, "repos", repoKey);
      const scopesPath = path.join(repoDir, "layer-scopes.yaml");
      if (!fs.existsSync(scopesPath)) {
        continue;
      }
      scopedPackets += 1;
      const scopes = loadLayerScopes(repoDir);
      expect(scopes.size).toBeGreaterThan(0);
      for (const layer of loadBenchmarkManifest(repoDir).coverage.layers) {
        const canonical = layer === "pii_signals" ? "mentions" : layer;
        if (scopes.has(canonical as typeof layer)) {
          const record = scopes.get(canonical as typeof layer)!;
          expect(record.provenance.review_state).toBe("accepted");
          expect(record.exhaustive_scope_files.length).toBeGreaterThan(0);
        }
      }
    }

    expect(scopedPackets).toBe(29);
  });

  it("does not use actor:user in component gold (KDATAP-ea44fe)", () => {
    const violations: string[] = [];

    for (const repoKey of repoKeys) {
      const repoDir = path.join(benchmarkRoot, "repos", repoKey);
      const annotations = loadAnnotations(repoDir, "components");
      for (const annotation of annotations) {
        if (annotation.subject.key === "actor:user") {
          violations.push(`${repoKey}:${annotation.id}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("retargets former actor:user gold to declared actor subtypes", () => {
    const migrated = new Map<
      string,
      { key: string; labels: string[]; name: string | undefined }
    >();

    for (const repoKey of repoKeys) {
      const repoDir = path.join(benchmarkRoot, "repos", repoKey);
      const annotations = loadAnnotations(repoDir, "components");
      for (const annotation of annotations) {
        if (ACTOR_USER_MIGRATION_IDS.includes(annotation.id as (typeof ACTOR_USER_MIGRATION_IDS)[number])) {
          migrated.set(annotation.id, {
            key: annotation.subject.key,
            labels: annotation.expected.labels,
            name: annotation.subject.name,
          });
        }
      }
    }

    expect(migrated.size).toBe(ACTOR_USER_MIGRATION_IDS.length);

    const suffixCounts = { customer: 0, admin: 0, employee: 0 };

    for (const id of ACTOR_USER_MIGRATION_IDS) {
      const row = migrated.get(id);
      expect(row).toBeDefined();

      expect(row!.labels).toHaveLength(1);
      expect(ALLOWED_ACTOR_LABELS.has(row!.labels[0])).toBe(true);
      expect(row!.key).toBe(`actor:${row!.labels[0]}`);

      const suffix = row!.key.slice("actor:".length);
      if (suffix === "customer" || suffix === "admin" || suffix === "employee") {
        suffixCounts[suffix] += 1;
      }

      expect(row!.name?.trim().length).toBeGreaterThan(0);
    }

    expect(suffixCounts).toEqual({ customer: 23, admin: 4, employee: 3 });
  });

  it("uses only declared actor subtypes for actor:* component gold keys", () => {
    const actorSubtypeIds = loadActorSubtypeIds();
    const violations: string[] = [];

    for (const repoKey of repoKeys) {
      const repoDir = path.join(benchmarkRoot, "repos", repoKey);
      const annotations = loadAnnotations(repoDir, "components");
      for (const annotation of annotations) {
        const key = annotation.subject.key;
        if (!key.startsWith("actor:")) {
          continue;
        }
        const suffix = key.slice("actor:".length);
        if (!actorSubtypeIds.has(suffix)) {
          violations.push(`${repoKey}:${annotation.id}:${key}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
