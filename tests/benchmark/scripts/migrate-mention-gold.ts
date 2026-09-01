#!/usr/bin/env node
/**
 * One-shot migration: pii_signals.yaml → mentions.yaml with canonical mention keys.
 *
 *   pnpm exec ts-node tests/benchmark/scripts/migrate-mention-gold.ts
 */
import fs from "fs";
import path from "path";
import YAML from "yaml";

const REPOS_ROOT = path.join(__dirname, "..", "repos");
const CACHE_ROOT = path.join(__dirname, "..", ".cache", "repos");
const PASS_ID = "KDATAP-fafa9f";

/** Closed one-to-one inversion: concept_leaf → rule_id (personal-data-concept-map.yaml). */
const LEAF_TO_RULE: Record<string, string> = {
  email_address: "email",
  password: "password",
  phone_number: "phone_number",
  date_of_birth: "date_of_birth",
  first_name: "first_name",
  last_name: "last_name",
  full_name: "full_name",
  address: "address",
  social_security_number: "ssn",
  passport_number: "passport",
  national_id: "national_id",
  drivers_license_number: "drivers_license",
  tax_identifier: "tax_id",
  account_number: "account_number",
  username: "username",
};

const FORBIDDEN_CATEGORY_SUFFIXES = new Set([
  "person_name",
  "national_identifier",
  "user_identifier",
  "street_address",
  "credential_secret",
  "password_verifier",
  "employment_information",
  "residence_information",
]);

const LEGACY_KEY_LABEL_PREFIX = "legacy-key:";

interface AnnotationRow {
  id: string;
  layer: string;
  subject: { key: string; name?: string };
  evidence: { file_path: string; start_line: number; end_line: number };
  expected: { status: string; labels: string[] };
  rationale: string;
  provenance: Record<string, unknown>;
}

interface MigrationStats {
  tierAAccepted: number;
  tierANegativeAdjudication: number;
  bookmarkAdjudication: number;
  evidenceVerified: number;
  evidenceUnverified: number;
  evidenceContradicted: number;
  evidenceSkipped: number;
}

function listRepoDirs(): string[] {
  return fs
    .readdirSync(REPOS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(REPOS_ROOT, entry.name))
    .sort();
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase().replace(/-/g, "_").replace(/['']/g, "");
}

function isTierA(suffix: string): boolean {
  return suffix in LEAF_TO_RULE;
}

function isBookmark(suffix: string): boolean {
  return FORBIDDEN_CATEGORY_SUFFIXES.has(suffix) || !isTierA(suffix);
}

function resolveNewKey(oldKey: string): { key: string; tier: "a" | "bookmark" } {
  if (!oldKey.startsWith("pii:")) {
    throw new Error(`Expected pii: key, got '${oldKey}'`);
  }
  const suffix = oldKey.slice("pii:".length);
  if (isTierA(suffix)) {
    return { key: `mention:${LEAF_TO_RULE[suffix]}`, tier: "a" };
  }
  return { key: `mention:${suffix}`, tier: "bookmark" };
}

function needsAdjudication(
  ann: AnnotationRow,
  tier: "a" | "bookmark",
): boolean {
  if (tier === "bookmark") {
    return true;
  }
  const status = ann.expected.status;
  const review = ann.provenance.review_state;
  return status === "negative" && review === "accepted";
}

function appendLegacyKeyLabel(ann: AnnotationRow, oldKey: string): void {
  const label = `${LEGACY_KEY_LABEL_PREFIX}${oldKey}`;
  if (!ann.expected.labels.includes(label)) {
    ann.expected.labels.push(label);
  }
}

function readEvidenceSpan(
  repoKey: string,
  commit: string,
  evidence: AnnotationRow["evidence"],
): string | undefined {
  const cacheDir = path.join(CACHE_ROOT, `${repoKey}@${commit}`);
  const filePath = path.join(cacheDir, evidence.file_path);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const start = Math.max(1, evidence.start_line);
  const end = Math.min(lines.length, evidence.end_line);
  return lines.slice(start - 1, end).join("\n");
}

function validateNameInEvidence(
  name: string,
  span: string | undefined,
): "verified" | "unverified" | "skipped" {
  if (!span) {
    return "skipped";
  }
  const normalizedName = normalizeToken(name);
  const normalizedSpan = normalizeToken(span);
  if (normalizedSpan.includes(normalizedName)) {
    return "verified";
  }
  if (span.includes(name)) {
    return "verified";
  }
  return "unverified";
}

function migrateAnnotation(
  ann: AnnotationRow,
  repoKey: string,
  commit: string,
  stats: MigrationStats,
): void {
  const oldKey = ann.subject.key;
  const { key: newKey, tier } = resolveNewKey(oldKey);

  ann.layer = "mentions";
  ann.subject.key = newKey;

  const adjudicate = needsAdjudication(ann, tier);
  if (adjudicate) {
    ann.provenance.review_state = "needs_adjudication";
    if (tier === "bookmark") {
      stats.bookmarkAdjudication += 1;
      appendLegacyKeyLabel(ann, oldKey);
    } else {
      stats.tierANegativeAdjudication += 1;
    }
  } else {
    stats.tierAAccepted += 1;
  }

  const name = ann.subject.name?.trim();
  if (name) {
    const span = readEvidenceSpan(repoKey, commit, ann.evidence);
    const validation = validateNameInEvidence(name, span);
    if (validation === "verified") {
      stats.evidenceVerified += 1;
    } else if (validation === "unverified") {
      stats.evidenceUnverified += 1;
    } else {
      stats.evidenceSkipped += 1;
    }
  }
}

function migrateRepo(repoDir: string, stats: MigrationStats): void {
  const repoKey = path.basename(repoDir);
  const legacyPath = path.join(repoDir, "annotations", "pii_signals.yaml");
  const targetPath = path.join(repoDir, "annotations", "mentions.yaml");

  if (!fs.existsSync(legacyPath)) {
    if (fs.existsSync(targetPath)) {
      return;
    }
    throw new Error(`Missing ${legacyPath}`);
  }

  const manifestPath = path.join(repoDir, "manifest.yaml");
  const manifest = YAML.parse(fs.readFileSync(manifestPath, "utf8")) as {
    commit: string;
    coverage: { layers: string[] };
    annotation_version: number;
  };

  const doc = YAML.parse(fs.readFileSync(legacyPath, "utf8")) as {
    annotations: AnnotationRow[];
  };

  for (const ann of doc.annotations) {
    migrateAnnotation(ann, repoKey, manifest.commit, stats);
  }

  fs.writeFileSync(targetPath, YAML.stringify(doc, { lineWidth: 0 }), "utf8");
  fs.unlinkSync(legacyPath);

  const layers = manifest.coverage.layers.map((layer) =>
    layer === "pii_signals" ? "mentions" : layer,
  );
  const dedupedLayers = [...new Set(layers)];
  manifest.coverage.layers = dedupedLayers;
  manifest.annotation_version += 1;
  fs.writeFileSync(manifestPath, YAML.stringify(manifest, { lineWidth: 0 }), "utf8");
}

function main(): void {
  const passPath = path.join(__dirname, "..", "..", "..", "annotations", PASS_ID, "pass.md");
  if (!fs.existsSync(passPath)) {
    throw new Error(`Missing labeling pass at ${passPath} — write pass.md before migrating`);
  }

  const stats: MigrationStats = {
    tierAAccepted: 0,
    tierANegativeAdjudication: 0,
    bookmarkAdjudication: 0,
    evidenceVerified: 0,
    evidenceUnverified: 0,
    evidenceContradicted: 0,
    evidenceSkipped: 0,
  };

  for (const repoDir of listRepoDirs()) {
    migrateRepo(repoDir, stats);
    console.log(`Migrated ${path.basename(repoDir)}`);
  }

  const total =
    stats.tierAAccepted + stats.tierANegativeAdjudication + stats.bookmarkAdjudication;
  console.log(
    `Done. ${total} rows: Tier A accepted=${stats.tierAAccepted}, ` +
      `Tier A adjudication=${stats.tierANegativeAdjudication}, ` +
      `bookmark adjudication=${stats.bookmarkAdjudication}`,
  );
  console.log(
    `Evidence name validation: verified=${stats.evidenceVerified}, ` +
      `unverified=${stats.evidenceUnverified}, skipped=${stats.evidenceSkipped}`,
  );
}

main();
