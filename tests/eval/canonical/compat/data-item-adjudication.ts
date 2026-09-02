import crypto from "crypto";
import fs from "fs";
import path from "path";

import type { AnnotationRecord, DataItemEvidenceValidation } from "../../../benchmark/schema";
import { loadBenchmarkManifest } from "../../../benchmark/manifest";
import { resolveDefaultBenchmarkRoot } from "../../../benchmark/paths";
import {
  FORBIDDEN_CATEGORY_LEAVES,
  loadPersonalDataConceptMap,
  normalizeConceptToken,
} from "../../../../src/eval/canonical/concept-map";
import {
  classifyDataItemRow,
  lookupLabelInConceptMap,
  lookupSuffixInConceptMap,
  type DataItemMigrationBucket,
  type MapLookupResult,
} from "./data-item-migration";

export const DATA_ITEM_ADJUDICATION_TASK =
  "KDATAP-25b2f474-1d4a-4279-bfcc-b6a73343714a";

export const ACCEPT_CEILING = 140;

export type AdjudicationDisposition = "accept" | "reject" | "unresolved";

export type AdjudicationConfidence = "high" | "medium" | "low";

export interface LabelCorrection {
  before: string[];
  after: string[];
  change_type: "annotation_defect";
  evidence: string;
  rationale: string;
}

export interface AdjudicationLedgerEntry {
  annotationId: string;
  repoKey: string;
  sourceBucket: DataItemMigrationBucket;
  disposition: AdjudicationDisposition;
  confidence: AdjudicationConfidence;
  conceptLeaf?: string;
  identityKey?: string;
  conceptAncestry?: string[];
  evidenceValidation: DataItemEvidenceValidation;
  evidenceSpanHash: string;
  rationale: string;
  labelCorrection?: LabelCorrection;
  contested: boolean;
}

export interface AdjudicationLedger {
  task: typeof DATA_ITEM_ADJUDICATION_TASK;
  totalRows: number;
  acceptCeiling: number;
  dispositions: Record<AdjudicationDisposition, number>;
  bySourceBucket: Record<string, Record<AdjudicationDisposition, number>>;
  labelCorrectionCount: number;
  contestedCount: number;
  entries: AdjudicationLedgerEntry[];
}

const CACHE_ROOT = path.join(__dirname, "..", "..", "..", "benchmark", ".cache", "repos");

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

const FORBIDDEN_CATEGORY_SET = new Set(
  FORBIDDEN_CATEGORY_LEAVES.map((leaf) => normalizeConceptToken(leaf)),
);

let validConceptLeaves: Set<string> | undefined;

function getValidConceptLeaves(): Set<string> {
  if (!validConceptLeaves) {
    validConceptLeaves = new Set(
      loadPersonalDataConceptMap().entries.map((entry) =>
        normalizeConceptToken(entry.conceptLeaf),
      ),
    );
  }
  return validConceptLeaves;
}

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

export function sha256Hex(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function readEvidenceSpanWithContext(
  repoKey: string,
  commit: string,
  evidence: AnnotationRecord["evidence"],
  contextLines = 5,
): { span: string; contextSpan: string } {
  const cacheDir = path.join(CACHE_ROOT, `${repoKey}@${commit}`);
  const filePath = path.join(cacheDir, evidence.file_path);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Cache miss for ${repoKey}@${commit}: ${evidence.file_path} (expected at ${filePath})`,
    );
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const start = Math.max(1, evidence.start_line);
  const end = Math.min(lines.length, evidence.end_line);
  const contextStart = Math.max(1, start - contextLines);
  const contextEnd = Math.min(lines.length, end + contextLines);

  return {
    span: lines.slice(start - 1, end).join("\n"),
    contextSpan: lines.slice(contextStart - 1, contextEnd).join("\n"),
  };
}

export function validateFieldInEvidence(
  suffix: string,
  name: string | undefined,
  span: string,
): DataItemEvidenceValidation {
  const normalizedSpan = normalizeToken(span);
  if (name) {
    const normalizedName = normalizeToken(name);
    if (normalizedSpan.includes(normalizedName) || span.includes(name)) {
      return "verified";
    }
  }
  const normalizedSuffix = normalizeToken(suffix);
  if (normalizedSpan.includes(normalizedSuffix)) {
    return "verified";
  }
  return "unverified";
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

function resolveMapEntry(
  suffix: string,
  label: string | undefined,
  bucket: DataItemMigrationBucket,
  classifiedMapEntry: MapLookupResult | undefined,
): MapLookupResult | undefined {
  if (classifiedMapEntry) {
    return classifiedMapEntry;
  }
  const suffixEntry = lookupSuffixInConceptMap(suffix);
  if (suffixEntry) {
    if (label && suffixLabelConflictsWithMap(suffixEntry, label)) {
      if (normalizeToken(label) === "password_verifier") {
        return undefined;
      }
      return lookupLabelInConceptMap(label) ?? undefined;
    }
    return suffixEntry;
  }
  if (label && !FORBIDDEN_CATEGORY_SET.has(normalizeToken(label))) {
    return lookupLabelInConceptMap(label);
  }
  return undefined;
}

function isNegativeMetadataField(suffix: string, span: string, name?: string): boolean {
  if (NEVER_AUTO_MAP_SUFFIXES.has(normalizeToken(suffix))) {
    return true;
  }
  const lower = span.toLowerCase();
  const metadataHints = [
    "constraint",
    "foreign key",
    "foreignkey",
    "priority",
    "realm",
    "tenant",
    "ordering",
    "deprecated",
    "enum ",
    "boolean ",
    "integer ",
    "int ",
    "bigint ",
    "serial ",
  ];
  if (metadataHints.some((hint) => lower.includes(hint))) {
    return true;
  }
  if (name && /^(type|status|priority|realm|label)$/i.test(name)) {
    return true;
  }
  return false;
}

function assertValidConceptLeaf(conceptLeaf: string): void {
  if (!getValidConceptLeaves().has(normalizeConceptToken(conceptLeaf))) {
    throw new Error(`Invented or forbidden concept_leaf '${conceptLeaf}' — not in concept map`);
  }
  if (FORBIDDEN_CATEGORY_SET.has(normalizeConceptToken(conceptLeaf))) {
    throw new Error(`Forbidden category leaf '${conceptLeaf}' cannot be assigned`);
  }
}

function buildLabelCorrection(
  label: string | undefined,
  mapEntry: MapLookupResult,
  span: string,
): LabelCorrection | undefined {
  if (!label) {
    return undefined;
  }
  const normalizedLabel = normalizeToken(label);
  const normalizedLeaf = normalizeConceptToken(mapEntry.conceptLeaf);
  if (normalizedLabel === normalizedLeaf) {
    return undefined;
  }
  const labelEntry = lookupLabelInConceptMap(label);
  if (labelEntry && labelEntry.ruleId === mapEntry.ruleId) {
    return undefined;
  }
  if (FORBIDDEN_CATEGORY_SET.has(normalizedLabel)) {
    return {
      before: [label],
      after: [mapEntry.conceptLeaf],
      change_type: "annotation_defect",
      evidence: span.trim().slice(0, 240),
      rationale: `Category label '${label}' replaced by source-confirmed concept leaf '${mapEntry.conceptLeaf}'.`,
    };
  }
  if (labelEntry && labelEntry.ruleId !== mapEntry.ruleId) {
    return {
      before: [label],
      after: [mapEntry.conceptLeaf],
      change_type: "annotation_defect",
      evidence: span.trim().slice(0, 240),
      rationale: `Label '${label}' conflicts with suffix semantics; source supports '${mapEntry.conceptLeaf}'.`,
    };
  }
  return undefined;
}

export interface AdjudicateRowInput {
  repoKey: string;
  record: AnnotationRecord;
  sourceBucket: DataItemMigrationBucket;
  span: string;
  contextSpan: string;
}

export function adjudicateDataItemRow(input: AdjudicateRowInput): AdjudicationLedgerEntry {
  const { repoKey, record, sourceBucket, span, contextSpan } = input;
  const suffix = parseDataItemSuffix(record.subject.key);
  const name = record.subject.name?.trim();
  const label = record.expected.labels[0]?.trim();
  const evidenceValidation = validateFieldInEvidence(suffix, name, span);
  const evidenceSpanHash = sha256Hex(contextSpan);
  const classified = classifyDataItemRow(record, evidenceValidation);
  const mapEntry = resolveMapEntry(suffix, label, sourceBucket, classified.mapEntry);

  const base = {
    annotationId: record.id,
    repoKey,
    sourceBucket,
    evidenceValidation,
    evidenceSpanHash,
    contested: false,
  };

  if (record.expected.status === "ambiguous") {
    return {
      ...base,
      disposition: "unresolved",
      confidence: "low",
      rationale: "Ambiguous status; deterministic path cannot resolve without human judgment.",
    };
  }

  if (record.expected.status === "negative") {
    if (mapEntry && evidenceValidation === "verified") {
      assertValidConceptLeaf(mapEntry.conceptLeaf);
      return {
        ...base,
        disposition: "accept",
        confidence: "medium",
        conceptLeaf: mapEntry.conceptLeaf,
        identityKey: `data_item:${mapEntry.ruleId}`,
        conceptAncestry: [...mapEntry.conceptAncestry],
        contested: true,
        rationale: `Source span confirms mapped personal-data field '${mapEntry.conceptLeaf}' despite negative label.`,
      };
    }
    if (isNegativeMetadataField(suffix, contextSpan, name) || evidenceValidation === "verified") {
      return {
        ...base,
        disposition: "reject",
        confidence: sourceBucket === "negative_adjudication" ? "high" : "medium",
        rationale: "Source confirms non-PII metadata or explicit negative case.",
      };
    }
    return {
      ...base,
      disposition: "unresolved",
      confidence: "low",
      rationale: "Negative case without deterministic source confirmation.",
    };
  }

  if (label && normalizeToken(label) === "password_verifier") {
    return {
      ...base,
      disposition: "unresolved",
      confidence: "low",
      rationale: "password_verifier is a gold category without concept-map leaf.",
    };
  }

  if (!mapEntry) {
    if (NEVER_AUTO_MAP_SUFFIXES.has(normalizeToken(suffix))) {
      return {
        ...base,
        disposition: "unresolved",
        confidence: "low",
        rationale: `Suffix '${suffix}' is never auto-mapped; no closed-map leaf applies.`,
      };
    }
    return {
      ...base,
      disposition: "unresolved",
      confidence: "low",
      rationale: "No concept-map leaf matches suffix or label.",
    };
  }

  if (evidenceValidation !== "verified") {
    return {
      ...base,
      disposition: "unresolved",
      confidence: "low",
      rationale: "Concept map match exists but source span does not verify the field identity.",
    };
  }

  assertValidConceptLeaf(mapEntry.conceptLeaf);

  const labelCorrection = buildLabelCorrection(label, mapEntry, span);
  const confidence: AdjudicationConfidence =
    sourceBucket === "tier_a_canonical_suffix" ? "high" : "medium";
  const contested =
    confidence !== "high" ||
    sourceBucket === "tier_e_never_auto_map" ||
    sourceBucket === "tier_c_category_unmapped";

  return {
    ...base,
    disposition: "accept",
    confidence,
    conceptLeaf: mapEntry.conceptLeaf,
    identityKey: `data_item:${mapEntry.ruleId}`,
    conceptAncestry: [...mapEntry.conceptAncestry],
    labelCorrection,
    contested,
    rationale: `Source verifies '${name ?? suffix}' as ${mapEntry.conceptLeaf} via closed concept map.`,
  };
}

export function analyzeDataItemForAdjudication(
  repoKey: string,
  record: AnnotationRecord,
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): AdjudicationLedgerEntry {
  const manifest = loadBenchmarkManifest(path.join(benchmarkRoot, "repos", repoKey));
  const { span, contextSpan } = readEvidenceSpanWithContext(
    repoKey,
    manifest.commit,
    record.evidence,
  );
  const suffix = parseDataItemSuffix(record.subject.key);
  const name = record.subject.name?.trim();
  const evidenceValidation = validateFieldInEvidence(suffix, name, span);
  const classified = classifyDataItemRow(record, evidenceValidation);

  return adjudicateDataItemRow({
    repoKey,
    record,
    sourceBucket: classified.bucket,
    span,
    contextSpan,
  });
}

function emptyDispositionCounts(): Record<AdjudicationDisposition, number> {
  return { accept: 0, reject: 0, unresolved: 0 };
}

export function buildAdjudicationLedger(
  rows: Array<{ repoKey: string; record: AnnotationRecord }>,
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): AdjudicationLedger {
  const dispositions = emptyDispositionCounts();
  const bySourceBucket: Record<string, Record<AdjudicationDisposition, number>> = {};
  let labelCorrectionCount = 0;
  let contestedCount = 0;

  const entries = rows.map(({ repoKey, record }) => {
    const entry = analyzeDataItemForAdjudication(repoKey, record, benchmarkRoot);
    dispositions[entry.disposition] += 1;
    const bucketCounts = bySourceBucket[entry.sourceBucket] ?? emptyDispositionCounts();
    bucketCounts[entry.disposition] += 1;
    bySourceBucket[entry.sourceBucket] = bucketCounts;
    if (entry.labelCorrection) {
      labelCorrectionCount += 1;
    }
    if (entry.contested) {
      contestedCount += 1;
    }
    return entry;
  });

  return {
    task: DATA_ITEM_ADJUDICATION_TASK,
    totalRows: entries.length,
    acceptCeiling: ACCEPT_CEILING,
    dispositions,
    bySourceBucket,
    labelCorrectionCount,
    contestedCount,
    entries,
  };
}

export function assertAcceptCeiling(ledger: AdjudicationLedger): void {
  if (ledger.dispositions.accept > ledger.acceptCeiling) {
    throw new Error(
      `Accept ceiling exceeded: ${ledger.dispositions.accept} accepts > ${ledger.acceptCeiling} limit`,
    );
  }
}
