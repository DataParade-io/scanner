import fs from "fs";
import path from "path";

import type {
  AnnotationRecord,
  DataItemAnnotationCandidate,
  DataItemEvidenceValidation,
} from "../../../benchmark/schema";
import { loadAnnotations, loadBenchmarkManifest } from "../../../benchmark/manifest";
import { resolveDefaultBenchmarkRoot } from "../../../benchmark/paths";
import { listBenchmarkRepoKeys } from "../../../benchmark/run-benchmark";
import {
  FORBIDDEN_CATEGORY_LEAVES,
  loadPersonalDataConceptMap,
  normalizeConceptToken,
  tryRuleIdToConceptEntry,
} from "../../../../src/eval/canonical/concept-map";
import { loadCanonicalGoldFromAnnotation } from "../gold/loader";
import type { CanonicalDisposition } from "../../../../src/eval/canonical/types";

export const DATA_ITEM_MIGRATION_TASK = "KDATAP-a0e80b4a-7703-4425-a056-c1c9b9ef0870";

export type DataItemMigrationBucket =
  | "tier_a_canonical_suffix"
  | "tier_b_label_guided"
  | "tier_c_category_unmapped"
  | "tier_d_evidence_hint"
  | "tier_e_never_auto_map"
  | "negative_rejected"
  | "negative_adjudication"
  | "ambiguous"
  | "proposed";

export interface DataItemMigrationLedgerEntry {
  annotationId: string;
  repoKey: string;
  bucket: DataItemMigrationBucket;
  legacySubjectKey: string;
  legacySuffix: string;
  subjectName?: string;
  keyMatchesName: boolean;
  mapMatch: boolean;
  label?: string;
  proposedIdentityKey?: string;
  proposedConceptLeaf?: string;
  proposedAncestry?: string[];
  evidenceValidation: DataItemEvidenceValidation;
  flipReviewState: boolean;
  writeCandidate: boolean;
  disposition: CanonicalDisposition;
}

export interface DataItemMigrationLedger {
  task: typeof DATA_ITEM_MIGRATION_TASK;
  totalRows: number;
  sourceTokenNoMapMatch: number;
  sourceTokenKeyed: number;
  acceptedSourceTokenBefore: number;
  acceptedSourceTokenAfter: number;
  buckets: Record<DataItemMigrationBucket, number>;
  entries: DataItemMigrationLedgerEntry[];
}

const NEVER_AUTO_MAP_SUFFIXES = new Set([
  "id",
  "uuid",
  "uid",
  "key",
  "status",
  "token",
  "location",
  "name",
  "locale",
  "merchant_id",
  "merchant_customer_id",
  "card_reference",
  "refresh_token",
  "access_token",
  "token_hash",
  "password_hash",
  "password_salt",
]);

import {
  PII_SIGNAL_ALIASES,
  normalizeIdentifierToken,
} from "../../../../src/pii-signals/pii-signal-aliases";

const FORBIDDEN_CATEGORY_SET = new Set(
  FORBIDDEN_CATEGORY_LEAVES.map((leaf) => normalizeConceptToken(leaf)),
);

const CACHE_ROOT = path.join(__dirname, "..", "..", "..", "benchmark", ".cache", "repos");

function normalizeToken(token: string): string {
  return normalizeConceptToken(token).replace(/['']/g, "");
}

function parseDataItemSuffix(key: string): string {
  const trimmed = key.trim();
  if (!trimmed.startsWith("data_item:")) {
    throw new Error(`Expected data_item: key, got '${key}'`);
  }
  return trimmed.slice("data_item:".length);
}

function buildConceptLeafToRuleId(): Map<string, string> {
  const map = loadPersonalDataConceptMap();
  const index = new Map<string, string>();
  for (const entry of map.entries) {
    index.set(normalizeConceptToken(entry.conceptLeaf), entry.ruleId);
  }
  return index;
}

export interface MapLookupResult {
  ruleId: string;
  conceptLeaf: string;
  conceptAncestry: readonly string[];
}

export function lookupSuffixInConceptMap(suffix: string): MapLookupResult | undefined {
  const normalized = normalizeToken(suffix);
  const byRule = tryRuleIdToConceptEntry(normalized);
  if (byRule) {
    return {
      ruleId: byRule.ruleId,
      conceptLeaf: byRule.conceptLeaf,
      conceptAncestry: byRule.conceptAncestry,
    };
  }

  const leafToRule = buildConceptLeafToRuleId();
  const ruleId = leafToRule.get(normalized);
  if (!ruleId) {
    return undefined;
  }
  const entry = tryRuleIdToConceptEntry(ruleId);
  if (!entry) {
    return undefined;
  }
  return {
    ruleId: entry.ruleId,
    conceptLeaf: entry.conceptLeaf,
    conceptAncestry: entry.conceptAncestry,
  };
}

export function lookupLabelInConceptMap(label: string): MapLookupResult | undefined {
  const leafToRule = buildConceptLeafToRuleId();
  const ruleId = leafToRule.get(normalizeToken(label));
  if (!ruleId) {
    return undefined;
  }
  const entry = tryRuleIdToConceptEntry(ruleId);
  if (!entry) {
    return undefined;
  }
  return {
    ruleId: entry.ruleId,
    conceptLeaf: entry.conceptLeaf,
    conceptAncestry: entry.conceptAncestry,
  };
}

export function isSourceTokenKeyedSuffix(suffix: string, name?: string): boolean {
  if (!lookupSuffixInConceptMap(suffix)) {
    return true;
  }
  if (!name) {
    return false;
  }
  return normalizeToken(suffix) === normalizeToken(name);
}

function readEvidenceSpan(
  repoKey: string,
  commit: string,
  evidence: AnnotationRecord["evidence"],
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

export function validateNameInEvidence(
  name: string,
  span: string | undefined,
): DataItemEvidenceValidation {
  if (!span) {
    return "skipped";
  }
  const normalizedName = normalizeToken(name);
  const normalizedSpan = normalizeToken(span);
  if (normalizedSpan.includes(normalizedName) || span.includes(name)) {
    return "verified";
  }
  return "unverified";
}

function resolveEvidenceHint(
  suffix: string,
  name: string | undefined,
  label: string | undefined,
): MapLookupResult | undefined {
  const candidates = [
    normalizeToken(suffix),
    name ? normalizeToken(name) : undefined,
  ].filter((value): value is string => Boolean(value));

  for (const token of candidates) {
    const ruleId = PII_SIGNAL_ALIASES[normalizeIdentifierToken(token)];
    if (!ruleId) {
      continue;
    }
    const entry = tryRuleIdToConceptEntry(ruleId);
    if (!entry) {
      continue;
    }
    if (label && normalizeToken(label) === normalizeToken(entry.conceptLeaf)) {
      return {
        ruleId: entry.ruleId,
        conceptLeaf: entry.conceptLeaf,
        conceptAncestry: entry.conceptAncestry,
      };
    }
  }
  return undefined;
}

function suffixLabelConflictsWithMap(
  suffixEntry: MapLookupResult,
  label: string,
): boolean {
  const normalizedLabel = normalizeToken(label);
  if (normalizedLabel === "password_verifier" && suffixEntry.ruleId === "password") {
    return true;
  }
  const labelEntry = lookupLabelInConceptMap(label);
  return labelEntry !== undefined && labelEntry.ruleId !== suffixEntry.ruleId;
}

export function classifyDataItemRow(
  record: AnnotationRecord,
  evidenceValidation: DataItemEvidenceValidation = "skipped",
): {
  bucket: DataItemMigrationBucket;
  mapEntry?: MapLookupResult;
  evidenceValidation: DataItemEvidenceValidation;
} {
  const suffix = parseDataItemSuffix(record.subject.key);
  const name = record.subject.name?.trim();
  const label = record.expected.labels[0]?.trim();

  if (record.expected.status === "ambiguous") {
    return { bucket: "ambiguous", evidenceValidation };
  }
  if (record.expected.status === "negative") {
    if (record.provenance.review_state === "rejected") {
      return { bucket: "negative_rejected", evidenceValidation };
    }
    return { bucket: "negative_adjudication", evidenceValidation };
  }
  if (record.provenance.review_state === "proposed") {
    return { bucket: "proposed", evidenceValidation };
  }

  const mapEntry = lookupSuffixInConceptMap(suffix);
  if (mapEntry) {
    if (label && suffixLabelConflictsWithMap(mapEntry, label)) {
      if (normalizeToken(label) === "password_verifier") {
        return { bucket: "tier_c_category_unmapped", evidenceValidation };
      }
      const labelEntry = lookupLabelInConceptMap(label);
      if (labelEntry) {
        return { bucket: "tier_b_label_guided", mapEntry: labelEntry, evidenceValidation };
      }
      return { bucket: "tier_c_category_unmapped", evidenceValidation };
    }
    return { bucket: "tier_a_canonical_suffix", mapEntry, evidenceValidation };
  }

  if (label && !FORBIDDEN_CATEGORY_SET.has(normalizeToken(label))) {
    const labelEntry = lookupLabelInConceptMap(label);
    if (labelEntry) {
      return { bucket: "tier_b_label_guided", mapEntry: labelEntry, evidenceValidation };
    }
  }

  if (NEVER_AUTO_MAP_SUFFIXES.has(normalizeToken(suffix))) {
    return { bucket: "tier_e_never_auto_map", evidenceValidation };
  }

  const hintEntry = resolveEvidenceHint(suffix, name, label);
  if (hintEntry) {
    return { bucket: "tier_d_evidence_hint", mapEntry: hintEntry, evidenceValidation };
  }

  return { bucket: "tier_c_category_unmapped", evidenceValidation };
}

function shouldWriteCandidate(bucket: DataItemMigrationBucket): boolean {
  return (
    bucket === "tier_a_canonical_suffix" ||
    bucket === "tier_b_label_guided" ||
    bucket === "tier_d_evidence_hint"
  );
}

function candidateConfidence(
  bucket: DataItemMigrationBucket,
  evidenceValidation: DataItemEvidenceValidation,
): DataItemAnnotationCandidate["candidate_confidence"] {
  if (bucket === "tier_a_canonical_suffix") {
    return "high";
  }
  if (bucket === "tier_b_label_guided") {
    return evidenceValidation === "verified" ? "high" : "medium";
  }
  return "low";
}

function candidateNotes(bucket: DataItemMigrationBucket): string | undefined {
  switch (bucket) {
    case "tier_a_canonical_suffix":
      return "Tier A: suffix maps to closed concept map; legacy subject.key preserved pending human acceptance.";
    case "tier_b_label_guided":
      return "Tier B: expected.labels concept_leaf maps to rule_id; legacy subject.key preserved pending human acceptance.";
    case "tier_d_evidence_hint":
      return "Tier D: evidence alias hint maps to rule_id; requires human acceptance.";
    default:
      return undefined;
  }
}

export function buildDataItemCandidate(
  bucket: DataItemMigrationBucket,
  mapEntry: MapLookupResult,
  evidenceValidation: DataItemEvidenceValidation,
): DataItemAnnotationCandidate {
  return {
    kind: "data_item",
    proposed_identity_key: `data_item:${mapEntry.ruleId}`,
    proposed_concept_leaf: mapEntry.conceptLeaf,
    proposed_ancestry: [...mapEntry.conceptAncestry],
    candidate_confidence: candidateConfidence(bucket, evidenceValidation),
    candidate_notes: candidateNotes(bucket),
    evidence_validation: evidenceValidation,
  };
}

export function shouldFlipReviewState(record: AnnotationRecord): boolean {
  if (record.provenance.review_state !== "accepted") {
    return false;
  }
  const suffix = parseDataItemSuffix(record.subject.key);
  return lookupSuffixInConceptMap(suffix) === undefined;
}

export function analyzeDataItemRecord(
  repoKey: string,
  record: AnnotationRecord,
): DataItemMigrationLedgerEntry {
  const suffix = parseDataItemSuffix(record.subject.key);
  const name = record.subject.name?.trim();
  const mapEntry = lookupSuffixInConceptMap(suffix);
  const mapMatch = mapEntry !== undefined;
  const keyMatchesName = name ? normalizeToken(suffix) === normalizeToken(name) : false;
  const label = record.expected.labels[0]?.trim();

  const manifest = loadBenchmarkManifest(path.join(resolveDefaultBenchmarkRoot(), "repos", repoKey));
  const evidenceValidation = name
    ? validateNameInEvidence(
        name,
        readEvidenceSpan(repoKey, manifest.commit, record.evidence),
      )
    : "skipped";

  const classified = classifyDataItemRow(record, evidenceValidation);
  let bucket = classified.bucket;
  let proposal = classified.mapEntry;
  if (bucket === "tier_d_evidence_hint" && !proposal) {
    bucket = "tier_c_category_unmapped";
  }

  const writeCandidate = proposal !== undefined && shouldWriteCandidate(bucket);
  const flipReviewState = shouldFlipReviewState(record);

  const { record: goldRecord } = loadCanonicalGoldFromAnnotation(record, { repoKey });

  return {
    annotationId: record.id,
    repoKey,
    bucket,
    legacySubjectKey: record.subject.key,
    legacySuffix: suffix,
    subjectName: name,
    keyMatchesName,
    mapMatch,
    label,
    proposedIdentityKey: proposal ? `data_item:${proposal.ruleId}` : undefined,
    proposedConceptLeaf: proposal?.conceptLeaf,
    proposedAncestry: proposal ? [...proposal.conceptAncestry] : undefined,
    evidenceValidation,
    flipReviewState,
    writeCandidate,
    disposition: goldRecord.disposition,
  };
}

export function listAllDataItemAnnotations(
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): Array<{ repoKey: string; record: AnnotationRecord }> {
  const rows: Array<{ repoKey: string; record: AnnotationRecord }> = [];
  for (const repoKey of listBenchmarkRepoKeys(benchmarkRoot)) {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const annotations = loadAnnotations(repoDir, "data_items");
    for (const record of annotations) {
      rows.push({ repoKey, record });
    }
  }
  return rows;
}

export function buildDataItemMigrationLedger(
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): DataItemMigrationLedger {
  const rows = listAllDataItemAnnotations(benchmarkRoot);
  const buckets = {
    tier_a_canonical_suffix: 0,
    tier_b_label_guided: 0,
    tier_c_category_unmapped: 0,
    tier_d_evidence_hint: 0,
    tier_e_never_auto_map: 0,
    negative_rejected: 0,
    negative_adjudication: 0,
    ambiguous: 0,
    proposed: 0,
  } satisfies Record<DataItemMigrationBucket, number>;

  let sourceTokenNoMapMatch = 0;
  let sourceTokenKeyed = 0;
  let acceptedSourceTokenBefore = 0;

  const entries = rows.map(({ repoKey, record }) => {
    const entry = analyzeDataItemRecord(repoKey, record);
    buckets[entry.bucket] += 1;
    if (!entry.mapMatch) {
      sourceTokenNoMapMatch += 1;
    }
    if (isSourceTokenKeyedSuffix(entry.legacySuffix, entry.subjectName)) {
      sourceTokenKeyed += 1;
    }
    if (record.provenance.review_state === "accepted" && !entry.mapMatch) {
      acceptedSourceTokenBefore += 1;
    }
    return entry;
  });

  const acceptedSourceTokenAfter = entries.filter(
    (entry) => !entry.mapMatch && !entry.flipReviewState,
  ).filter((entry) => {
    const row = rows.find((candidate) => candidate.record.id === entry.annotationId);
    return row?.record.provenance.review_state === "accepted";
  }).length;

  return {
    task: DATA_ITEM_MIGRATION_TASK,
    totalRows: entries.length,
    sourceTokenNoMapMatch,
    sourceTokenKeyed,
    acceptedSourceTokenBefore,
    acceptedSourceTokenAfter,
    buckets,
    entries,
  };
}

export function applyDataItemMigrationToRecord(
  record: AnnotationRecord,
  entry: DataItemMigrationLedgerEntry,
): AnnotationRecord {
  const updated: AnnotationRecord = {
    ...record,
    provenance: { ...record.provenance },
  };

  if (entry.flipReviewState) {
    updated.provenance.review_state = "needs_adjudication";
  }

  if (entry.writeCandidate && entry.proposedConceptLeaf && entry.proposedIdentityKey) {
    updated.candidate = buildDataItemCandidate(
      entry.bucket,
      {
        ruleId: entry.proposedIdentityKey.replace(/^data_item:/, ""),
        conceptLeaf: entry.proposedConceptLeaf,
        conceptAncestry: entry.proposedAncestry ?? [entry.proposedConceptLeaf],
      },
      entry.evidenceValidation,
    );
  } else {
    delete updated.candidate;
  }

  return updated;
}
