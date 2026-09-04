import path from "path";

import type { AnnotationRecord } from "../../../benchmark/schema";
import { loadBenchmarkManifest } from "../../../benchmark/manifest";
import { resolveDefaultBenchmarkRoot } from "../../../benchmark/paths";
import { tryRuleIdToConceptEntry } from "../../../../src/eval/canonical/concept-map";
import {
  classifyDataItemRow,
  listAllDataItemAnnotations,
  lookupLabelInConceptMap,
  lookupSuffixInConceptMap,
  type DataItemMigrationBucket,
  type MapLookupResult,
} from "./data-item-migration";
import {
  readEvidenceSpanWithContext,
  sha256Hex,
  validateFieldInEvidence,
  type AdjudicationConfidence,
  type AdjudicationDisposition,
  type AdjudicationLedgerEntry,
  type LabelCorrection,
} from "./data-item-adjudication";

export const DATA_ITEM_ADJUDICATION_SLICE2_TASK = "KDATAP-6b1c67";

const EVIDENCE_ALIAS_TO_RULE: Record<string, string> = {
  mail: "email",
  user_email: "email",
  invite_email: "email",
  e_mail: "email",
  phone: "phone_number",
  mobile: "phone_number",
  tel: "phone_number",
  firstname: "first_name",
  lastname: "last_name",
  pass: "password",
  passwd: "password",
  user_pass: "password",
  user_password: "password",
  share_password: "password",
  ssn: "ssn",
  social_security: "ssn",
};

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

const PASSWORD_VERIFIER_PATTERNS = [
  /password_hash/i,
  /hashed_password/i,
  /PasswordHash/i,
  /hash_password/i,
  /getPasswordHash/i,
  /bcrypt/i,
  /argon/i,
  /scrypt/i,
  /hashed_password/i,
  /application_password.*hash/i,
  /:string\(64\).*password/i,
];

const SURROGATE_KEY_PATTERNS = [
  /primary key/i,
  /foreign key/i,
  /autoincr/i,
  /pk autoincr/i,
  /@Id\b/i,
  /bigserial/i,
  /serial primary/i,
];

const NON_PII_REJECT_SUFFIXES = new Set([
  "avatar_url",
  "timezone",
  "logout_token",
  "card_reference",
  "merchant_id",
  "merchant_customer_id",
  "token_hash",
  "password_hash",
  "password_salt",
  "auth_source_id",
  "login_route",
]);

const NON_PII_REJECT_CONTEXT = [
  /avatar_url/i,
  /avatar/i,
  /timezone/i,
  /logout_token/i,
  /not null, primary key/i,
  /personal access token/i,
];

function normalizeToken(token: string): string {
  return token.trim().toLowerCase().replace(/-/g, "_").replace(/['']/g, "");
}

function parseDataItemSuffix(key: string): string {
  const trimmed = key.trim();
  if (!trimmed.startsWith("data_item:")) {
    throw new Error(`Expected data_item: key, got '${key}'`);
  }
  return trimmed.slice("data_item:".length);
}

function lookupAliasInConceptMap(token: string): MapLookupResult | undefined {
  const ruleId = EVIDENCE_ALIAS_TO_RULE[normalizeToken(token)];
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

function lookupCompoundSuffixInConceptMap(suffix: string): MapLookupResult | undefined {
  const normalized = normalizeToken(suffix);
  if (normalized.endsWith("_username") || normalized === "username") {
    return lookupSuffixInConceptMap("username");
  }
  if (
    normalized.endsWith("_email") ||
    normalized === "email" ||
    (normalized.endsWith("email") && !normalized.includes("hash"))
  ) {
    return lookupSuffixInConceptMap("email");
  }
  if (normalized.endsWith("_phone") || normalized === "phone") {
    return lookupSuffixInConceptMap("phone_number");
  }
  if (normalized.endsWith("_firstname") || normalized === "firstname") {
    return lookupAliasInConceptMap("firstname");
  }
  if (normalized.endsWith("_lastname") || normalized === "lastname") {
    return lookupAliasInConceptMap("lastname");
  }
  return undefined;
}

function resolveSlice2MapEntry(
  suffix: string,
  name: string | undefined,
  classifiedMapEntry: MapLookupResult | undefined,
): MapLookupResult | undefined {
  if (classifiedMapEntry) {
    return classifiedMapEntry;
  }

  const suffixEntry = lookupSuffixInConceptMap(suffix);
  if (suffixEntry) {
    return suffixEntry;
  }

  const compoundEntry = lookupCompoundSuffixInConceptMap(suffix);
  if (compoundEntry) {
    return compoundEntry;
  }

  if (name) {
    const nameEntry = lookupSuffixInConceptMap(name);
    if (nameEntry) {
      return nameEntry;
    }
    const nameAlias = lookupAliasInConceptMap(name);
    if (nameAlias) {
      return nameAlias;
    }
    const nameCompound = lookupCompoundSuffixInConceptMap(name);
    if (nameCompound) {
      return nameCompound;
    }
  }

  const suffixAlias = lookupAliasInConceptMap(suffix);
  if (suffixAlias) {
    return suffixAlias;
  }

  return undefined;
}

function isPasswordVerifierField(span: string, contextSpan: string, suffix: string): boolean {
  const haystack = `${span}\n${contextSpan}`;
  if (PASSWORD_VERIFIER_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return true;
  }
  const normalizedSuffix = normalizeToken(suffix);
  return normalizedSuffix === "password_hash" || normalizedSuffix === "hashed_password";
}

function isSurrogateKey(contextSpan: string, suffix: string): boolean {
  const normalized = normalizeToken(suffix);
  if (!["id", "uuid", "uid", "key"].includes(normalized)) {
    return false;
  }
  return SURROGATE_KEY_PATTERNS.some((pattern) => pattern.test(contextSpan));
}

function isNegativeAbsentField(
  suffix: string,
  name: string | undefined,
  span: string,
  contextSpan: string,
): boolean {
  const tokens = [suffix, name].filter((value): value is string => Boolean(value));
  const haystack = normalizeToken(`${span}\n${contextSpan}`);
  return tokens.every((token) => !haystack.includes(normalizeToken(token)));
}

function isRouteOrConfigNegative(contextSpan: string): boolean {
  return /Joi\.|routes\.|route config|not pii|not personal/i.test(contextSpan);
}

function isNonPiiInfrastructure(
  suffix: string,
  name: string | undefined,
  span: string,
  contextSpan: string,
  record: AnnotationRecord,
): boolean {
  const normalizedSuffix = normalizeToken(suffix);
  if (NON_PII_REJECT_SUFFIXES.has(normalizedSuffix)) {
    return true;
  }
  if (NON_PII_REJECT_CONTEXT.some((pattern) => pattern.test(span))) {
    return true;
  }
  if (/not null, primary key/i.test(contextSpan)) {
    return true;
  }
  if (normalizedSuffix === "name" && record.expected.status === "ambiguous") {
    if (/AccessToken|access token|token struct/i.test(contextSpan)) {
      return true;
    }
  }
  if (
    ["ip_address", "registration_ip_address", "external_identifier", "provider_uid", "sub", "sid"].includes(
      normalizedSuffix,
    )
  ) {
    return true;
  }
  if (name && normalizeToken(name) === "routes" && normalizedSuffix === "login_route") {
    return true;
  }
  return false;
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
  const normalizedLeaf = normalizeToken(mapEntry.conceptLeaf);
  if (normalizedLabel === normalizedLeaf) {
    return undefined;
  }
  const labelEntry = lookupLabelInConceptMap(label);
  if (labelEntry && labelEntry.ruleId === mapEntry.ruleId) {
    return undefined;
  }
  return {
    before: [label],
    after: [mapEntry.conceptLeaf],
    change_type: "annotation_defect",
    evidence: span.trim().slice(0, 240),
    rationale: `Category or conflicting label '${label}' replaced by source-confirmed concept leaf '${mapEntry.conceptLeaf}'.`,
  };
}

function buildEntry(
  base: Omit<AdjudicationLedgerEntry, "disposition" | "confidence" | "rationale">,
  disposition: AdjudicationDisposition,
  confidence: AdjudicationConfidence,
  rationale: string,
  mapEntry?: MapLookupResult,
  labelCorrection?: LabelCorrection,
  contested = false,
): AdjudicationLedgerEntry {
  return {
    ...base,
    disposition,
    confidence,
    rationale,
    conceptLeaf: mapEntry?.conceptLeaf,
    identityKey: mapEntry ? `data_item:${mapEntry.ruleId}` : undefined,
    conceptAncestry: mapEntry ? [...mapEntry.conceptAncestry] : undefined,
    labelCorrection,
    contested,
  };
}

export interface AdjudicateSlice2Input {
  repoKey: string;
  record: AnnotationRecord;
  sourceBucket: DataItemMigrationBucket;
  span: string;
  contextSpan: string;
}

export function adjudicateDataItemRowSlice2(input: AdjudicateSlice2Input): AdjudicationLedgerEntry {
  const { repoKey, record, sourceBucket, span, contextSpan } = input;
  const suffix = parseDataItemSuffix(record.subject.key);
  const name = record.subject.name?.trim();
  const label = record.expected.labels[0]?.trim();
  const evidenceValidation = validateFieldInEvidence(suffix, name, span);
  const evidenceSpanHash = sha256Hex(contextSpan);
  const classified = classifyDataItemRow(record, evidenceValidation);
  const mapEntry = resolveSlice2MapEntry(suffix, name, classified.mapEntry);

  const base = {
    annotationId: record.id,
    repoKey,
    sourceBucket,
    evidenceValidation,
    evidenceSpanHash,
    contested: false,
  };

  if (isNonPiiInfrastructure(suffix, name, span, contextSpan, record)) {
    return buildEntry(
      base,
      "reject",
      "high",
      "Source confirms infrastructure, surrogate, or non-mapped metadata — not personal-data gold.",
    );
  }

  if (record.expected.status === "negative") {
    if (mapEntry && evidenceValidation === "verified" && !isPasswordVerifierField(span, contextSpan, suffix)) {
      return buildEntry(
        base,
        "accept",
        "medium",
        `Source span confirms mapped personal-data field '${mapEntry.conceptLeaf}' despite negative label.`,
        mapEntry,
        buildLabelCorrection(label, mapEntry, span),
        true,
      );
    }
    if (
      evidenceValidation === "verified" ||
      isSurrogateKey(contextSpan, suffix) ||
      isNegativeAbsentField(suffix, name, span, contextSpan) ||
      isRouteOrConfigNegative(contextSpan) ||
      isNonPiiInfrastructure(suffix, name, span, contextSpan, record)
    ) {
      return buildEntry(
        base,
        "reject",
        "high",
        "Source confirms explicit negative or non-PII metadata.",
      );
    }
    return buildEntry(
      base,
      "unresolved",
      "low",
      "Negative case without deterministic source confirmation.",
    );
  }

  if (label && normalizeToken(label) === "password_verifier") {
    if (isPasswordVerifierField(span, contextSpan, suffix)) {
      return buildEntry(
        base,
        "reject",
        "high",
        "Source confirms password hash or verifier storage, not plaintext password data item.",
      );
    }
    if (mapEntry?.ruleId === "password" && evidenceValidation === "verified") {
      return buildEntry(
        base,
        "accept",
        "medium",
        `Source verifies plaintext password field '${name ?? suffix}' as ${mapEntry.conceptLeaf}.`,
        mapEntry,
        buildLabelCorrection(label, mapEntry, span),
        true,
      );
    }
    return buildEntry(
      base,
      "unresolved",
      "low",
      "password_verifier label without deterministic hash-vs-plaintext resolution.",
    );
  }

  if (NEVER_AUTO_MAP_SUFFIXES.has(normalizeToken(suffix))) {
    if (isSurrogateKey(contextSpan, suffix)) {
      return buildEntry(
        base,
        "reject",
        "high",
        `Suffix '${suffix}' is a surrogate primary or foreign key, not personal data.`,
      );
    }
    if (record.expected.status === "ambiguous") {
      return buildEntry(
        base,
        "unresolved",
        "low",
        "Ambiguous field without closed-map leaf or deterministic PII semantics.",
      );
    }
    return buildEntry(
      base,
      "unresolved",
      "low",
      `Suffix '${suffix}' has no closed-map leaf and source does not support deterministic resolution.`,
    );
  }

  if (!mapEntry) {
    if (record.expected.status === "ambiguous") {
      return buildEntry(
        base,
        "unresolved",
        "low",
        "Ambiguous status without closed-map leaf.",
      );
    }
    return buildEntry(
      base,
      "unresolved",
      "low",
      "No concept-map leaf matches suffix, name, or alias.",
    );
  }

  if (evidenceValidation !== "verified") {
    return buildEntry(
      base,
      "unresolved",
      "low",
      "Concept map match exists but source span does not verify the field identity.",
    );
  }

  if (isPasswordVerifierField(span, contextSpan, suffix) && mapEntry.ruleId === "password") {
    return buildEntry(
      base,
      "reject",
      "high",
      "Source confirms password verifier/hash storage rather than plaintext password.",
    );
  }

  const labelCorrection = buildLabelCorrection(label, mapEntry, span);
  const confidence: AdjudicationConfidence =
    sourceBucket === "tier_a_canonical_suffix" || lookupAliasInConceptMap(suffix)
      ? "high"
      : "medium";
  const contested =
    confidence !== "high" ||
    sourceBucket === "tier_c_category_unmapped" ||
    sourceBucket === "tier_e_never_auto_map" ||
    sourceBucket === "ambiguous" ||
    Boolean(labelCorrection);

  return buildEntry(
    base,
    "accept",
    confidence,
    `Source verifies '${name ?? suffix}' as ${mapEntry.conceptLeaf} via closed concept map.`,
    mapEntry,
    labelCorrection,
    contested,
  );
}

export interface Slice2AdjudicationLedger {
  task: typeof DATA_ITEM_ADJUDICATION_SLICE2_TASK;
  totalRows: number;
  dispositions: Record<AdjudicationDisposition, number>;
  bySourceBucket: Record<string, Record<AdjudicationDisposition, number>>;
  labelCorrectionCount: number;
  contestedCount: number;
  entries: AdjudicationLedgerEntry[];
}

function emptyDispositionCounts(): Record<AdjudicationDisposition, number> {
  return { accept: 0, reject: 0, unresolved: 0 };
}

export function analyzeDataItemForSlice2Adjudication(
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

  return adjudicateDataItemRowSlice2({
    repoKey,
    record,
    sourceBucket: classified.bucket,
    span,
    contextSpan,
  });
}

export function buildSlice2AdjudicationLedger(
  rows: Array<{ repoKey: string; record: AnnotationRecord }>,
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): Slice2AdjudicationLedger {
  const dispositions = emptyDispositionCounts();
  const bySourceBucket: Record<string, Record<AdjudicationDisposition, number>> = {};
  let labelCorrectionCount = 0;
  let contestedCount = 0;

  const entries = rows.map(({ repoKey, record }) => {
    const entry = analyzeDataItemForSlice2Adjudication(repoKey, record, benchmarkRoot);
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
    task: DATA_ITEM_ADJUDICATION_SLICE2_TASK,
    totalRows: entries.length,
    dispositions,
    bySourceBucket,
    labelCorrectionCount,
    contestedCount,
    entries,
  };
}

export function listUnresolvedDataItemRows(
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): Array<{ repoKey: string; record: AnnotationRecord }> {
  return listAllDataItemAnnotations(benchmarkRoot).filter(
    ({ record }) => record.provenance.review_state === "needs_adjudication",
  );
}

