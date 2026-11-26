/**
 * Third-party vendor labels (DATAP-789, DATAP-895).
 *
 * One record per vendor that a packet's in-scope code reaches, in
 * `repos/<key>/annotations/third_parties.yaml`. A record names the vendor by the same
 * component identity key the components layer uses (`third_party:<vendor>`), so it reuses
 * the existing node type. It adds what the component gold does not hold: the data
 * categories sent, the subprocessor status, the route (SDK or raw HTTP) and the
 * provenance (manifest entry, import, call sites).
 *
 * The labels are closed-world over the packet's manifest scope: every vendor that in-scope
 * code sends data to has a record. Declared dependencies that send nothing have a record
 * with `sends_data: false`; they are reported apart and are not scored.
 */
import fs from "fs";
import path from "path";
import YAML from "yaml";

import type { BenchmarkManifest, ReviewState } from "./schema";
import { REVIEW_STATES } from "./schema";

export const THIRD_PARTY_LABELS_FILE = "third_parties.yaml";
export const THIRD_PARTY_LABELS_VERSION = "third-party-labels/1";

export type ThirdPartyRoute = "sdk" | "raw_http" | "both";
export type SubprocessorStatus = "yes" | "no" | "unknown";

export const THIRD_PARTY_ROUTES: readonly ThirdPartyRoute[] = ["sdk", "raw_http", "both"];
export const SUBPROCESSOR_STATUSES: readonly SubprocessorStatus[] = ["yes", "no", "unknown"];

/**
 * Data categories a vendor record may name. Personal categories reuse the concept leaves
 * of `patterns/personal-data-concept-map.yaml` where one exists; the rest name what a
 * vendor receives that the personal-data taxonomy has no leaf for.
 */
export const THIRD_PARTY_DATA_CATEGORIES: readonly string[] = [
  // people and accounts
  "email",
  "person_name",
  "phone_number",
  "address",
  "date_of_birth",
  "government_id",
  "user_id",
  "username",
  "ip_address",
  "device_id",
  "location",
  "profile",
  // secrets and sessions
  "password",
  "access_token",
  "credentials",
  "session",
  // money
  "payment_card",
  "bank_account",
  "transaction",
  "order",
  // content
  "message_content",
  "post_content",
  "prompt_content",
  "file_content",
  "media",
  "document",
  "search_query",
  // operations
  "error_report",
  "telemetry",
  "usage_events",
  "configuration",
  // nothing personal (for example public metadata or a public API lookup)
  "non_personal",
];

export interface ThirdPartyLocation {
  file_path: string;
  line: number;
}

export interface ThirdPartyManifestEntry extends ThirdPartyLocation {
  package: string;
}

export interface ThirdPartyImport extends ThirdPartyLocation {
  module: string;
}

export interface ThirdPartyProvenance {
  manifest: ThirdPartyManifestEntry[];
  imports: ThirdPartyImport[];
  call_sites: ThirdPartyLocation[];
}

export interface ThirdPartyVendorLabel {
  /** Vendor name, lowercase, the way the components layer names it. */
  vendor: string;
  /** Component identity key, `third_party:<name>`. */
  subject_key: string;
  /** Other identity keys that name the same vendor (for example `third_party:openai` for Azure OpenAI). */
  aliases?: string[];
  component_subtype: string;
  sends_data: boolean;
  route: ThirdPartyRoute;
  subprocessor: SubprocessorStatus;
  data_categories: string[];
  provenance: ThirdPartyProvenance;
  uncertain: boolean;
  rationale: string;
  review_state: ReviewState;
  proposed_by: string;
  proposed_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
}

export interface ThirdPartyLabelsFile {
  version: string;
  scope_note?: string;
  vendors: ThirdPartyVendorLabel[];
}

function fail(where: string, message: string): never {
  throw new Error(`${where}: ${message}`);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(where, "expected a mapping");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(where, "expected a non-empty string");
  }
  return value;
}

function asDateString(value: unknown, where: string): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return asString(value, where);
}

function asLine(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(where, "expected a line number of 1 or more");
  }
  return value;
}

function asArray(value: unknown, where: string): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(where, "expected a list");
  }
  return value;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(where, `expected one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function parseLocation(value: unknown, where: string): ThirdPartyLocation {
  const row = asRecord(value, where);
  return {
    file_path: asString(row.file_path, `${where}.file_path`),
    line: asLine(row.line, `${where}.line`),
  };
}

function parseVendor(value: unknown, where: string): ThirdPartyVendorLabel {
  const row = asRecord(value, where);
  const vendor = asString(row.vendor, `${where}.vendor`);
  if (vendor !== vendor.toLowerCase()) {
    fail(`${where}.vendor`, "must be lowercase");
  }
  const subjectKey = asString(row.subject_key, `${where}.subject_key`);
  if (!subjectKey.startsWith("third_party:")) {
    fail(`${where}.subject_key`, "must start with third_party:");
  }
  const aliases = asArray(row.aliases, `${where}.aliases`).map((alias, index) => {
    const key = asString(alias, `${where}.aliases[${index}]`);
    if (!key.startsWith("third_party:")) {
      fail(`${where}.aliases[${index}]`, "must start with third_party:");
    }
    return key;
  });
  if (typeof row.sends_data !== "boolean") {
    fail(`${where}.sends_data`, "expected true or false");
  }
  if (typeof row.uncertain !== "boolean") {
    fail(`${where}.uncertain`, "expected true or false");
  }
  const categories = asArray(row.data_categories, `${where}.data_categories`).map((entry, index) =>
    asEnum(entry, THIRD_PARTY_DATA_CATEGORIES, `${where}.data_categories[${index}]`),
  );
  if (row.sends_data && categories.length === 0) {
    fail(`${where}.data_categories`, "a vendor that receives data needs at least one category");
  }
  const provenanceRow = asRecord(row.provenance ?? {}, `${where}.provenance`);
  const provenance: ThirdPartyProvenance = {
    manifest: asArray(provenanceRow.manifest, `${where}.provenance.manifest`).map((entry, index) => {
      const at = `${where}.provenance.manifest[${index}]`;
      const loc = parseLocation(entry, at);
      return { ...loc, package: asString(asRecord(entry, at).package, `${at}.package`) };
    }),
    imports: asArray(provenanceRow.imports, `${where}.provenance.imports`).map((entry, index) => {
      const at = `${where}.provenance.imports[${index}]`;
      const loc = parseLocation(entry, at);
      return { ...loc, module: asString(asRecord(entry, at).module, `${at}.module`) };
    }),
    call_sites: asArray(provenanceRow.call_sites, `${where}.provenance.call_sites`).map(
      (entry, index) => parseLocation(entry, `${where}.provenance.call_sites[${index}]`),
    ),
  };
  if (row.sends_data && provenance.call_sites.length === 0) {
    fail(`${where}.provenance.call_sites`, "a vendor that receives data needs at least one call site");
  }
  if (!row.sends_data && provenance.manifest.length === 0 && provenance.imports.length === 0) {
    fail(`${where}.provenance`, "a declared-only vendor needs a manifest entry or an import");
  }
  const label: ThirdPartyVendorLabel = {
    vendor,
    subject_key: subjectKey,
    component_subtype: asString(row.component_subtype, `${where}.component_subtype`),
    sends_data: row.sends_data,
    route: asEnum(row.route, THIRD_PARTY_ROUTES, `${where}.route`),
    subprocessor: asEnum(row.subprocessor, SUBPROCESSOR_STATUSES, `${where}.subprocessor`),
    data_categories: categories,
    provenance,
    uncertain: row.uncertain,
    rationale: asString(row.rationale, `${where}.rationale`),
    review_state: asEnum(row.review_state, REVIEW_STATES, `${where}.review_state`),
    proposed_by: asString(row.proposed_by, `${where}.proposed_by`),
    proposed_at: asDateString(row.proposed_at, `${where}.proposed_at`),
  };
  if (aliases.length > 0) {
    label.aliases = aliases;
  }
  if (row.reviewed_by !== undefined) {
    label.reviewed_by = asString(row.reviewed_by, `${where}.reviewed_by`);
  }
  if (row.reviewed_at !== undefined) {
    label.reviewed_at = asDateString(row.reviewed_at, `${where}.reviewed_at`);
  }
  return label;
}

export function parseThirdPartyLabels(raw: unknown, where: string): ThirdPartyLabelsFile {
  const root = asRecord(raw, where);
  const version = asString(root.version, `${where}.version`);
  if (version !== THIRD_PARTY_LABELS_VERSION) {
    fail(`${where}.version`, `expected ${THIRD_PARTY_LABELS_VERSION}`);
  }
  const vendors = asArray(root.vendors, `${where}.vendors`).map((entry, index) =>
    parseVendor(entry, `${where}.vendors[${index}]`),
  );
  const seen = new Set<string>();
  for (const vendor of vendors) {
    if (seen.has(vendor.subject_key)) {
      fail(where, `vendor ${vendor.subject_key} is listed twice; use one record per vendor`);
    }
    seen.add(vendor.subject_key);
  }
  const file: ThirdPartyLabelsFile = { version, vendors };
  if (root.scope_note !== undefined) {
    file.scope_note = asString(root.scope_note, `${where}.scope_note`);
  }
  return file;
}

/** Load `annotations/third_parties.yaml` for a packet, or null when it has none. */
export function loadThirdPartyLabels(repoDir: string): ThirdPartyLabelsFile | null {
  const filePath = path.join(repoDir, "annotations", THIRD_PARTY_LABELS_FILE);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return parseThirdPartyLabels(YAML.parse(fs.readFileSync(filePath, "utf8")), filePath);
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/** One scope pattern: a file, a directory (trailing `/` optional), or a glob with `*` and `**\/`. */
function matchesScopePattern(file: string, pattern: string): boolean {
  const entry = pattern.trim();
  if (entry === "" || entry === ".") return true;
  if (entry.includes("*")) {
    const directory = entry.endsWith("/");
    const body = normalizePath(entry)
      .split(/(\*\*\/|\*)/)
      .map((part) => (part === "**/" ? "(?:.*/)?" : part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")))
      .join("");
    return new RegExp(`^${body}${directory ? "(?:/.*)?" : ""}$`).test(file);
  }
  const prefix = normalizePath(entry);
  return file === prefix || file.startsWith(`${prefix}/`);
}

/** Manifest scope entries may list several patterns joined by commas. */
function scopePatterns(entry: string): string[] {
  return entry.split(",").map((part) => part.trim()).filter(Boolean);
}

/** True when a repo-relative file lies inside the manifest's include paths and outside its excludes. */
export function isInManifestScope(filePath: string, manifest: BenchmarkManifest): boolean {
  const file = normalizePath(filePath);
  const matches = (entry: string) => scopePatterns(entry).some((pattern) => matchesScopePattern(file, pattern));
  if (!manifest.scope.include.some(matches)) {
    return false;
  }
  return !(manifest.scope.exclude ?? []).some((entry) => matches(entry.path));
}

/** A third-party component as the scanner reported it. */
export interface PredictedVendor {
  key: string;
  locations: ThirdPartyLocation[];
}

/** Third-party predictions from benchmark layer findings (components layer, `third_party:` keys). */
export function predictedVendorsFromFindings(
  findings: { key: string; layer?: string; sourceLines?: { file_path: string; start_line?: number }[]; sourceFilePaths?: string[] }[],
): PredictedVendor[] {
  return findings
    .filter((finding) => finding.layer === "components" && finding.key.startsWith("third_party:"))
    .map((finding) => ({
      key: finding.key,
      locations:
        finding.sourceLines && finding.sourceLines.length > 0
          ? finding.sourceLines.map((line) => ({ file_path: line.file_path, line: line.start_line ?? 1 }))
          : (finding.sourceFilePaths ?? []).map((file) => ({ file_path: file, line: 1 })),
    }));
}

export type VendorMissCause = "no_sdk_mapping" | "raw_http_missed" | "provenance_wrong";

export interface VendorMiss {
  subject_key: string;
  route: ThirdPartyRoute;
  cause: VendorMissCause;
  uncertain: boolean;
}

export interface ThirdPartyScore {
  goldVendors: number;
  predictedVendors: number;
  /** Gold vendors the scanner reported at all, whatever the location. */
  vendorHits: number;
  /** Gold vendors the scanner reported at a labelled manifest entry, import or call site. */
  hits: number;
  recall: number | null;
  vendorRecall: number | null;
  /** Gold vendors not marked uncertain, and the hits among them. */
  certainGoldVendors: number;
  certainHits: number;
  certainRecall: number | null;
  precision: number | null;
  misses: VendorMiss[];
  missesByCause: Record<VendorMissCause, number>;
  falsePositives: string[];
  declaredOnly: { subject_key: string; reported: boolean }[];
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function vendorKeys(label: ThirdPartyVendorLabel): string[] {
  return [label.subject_key, ...(label.aliases ?? [])];
}

function provenanceFiles(label: ThirdPartyVendorLabel): Set<string> {
  const { manifest, imports, call_sites } = label.provenance;
  return new Set([...manifest, ...imports, ...call_sites].map((loc) => normalizePath(loc.file_path)));
}

/**
 * Score the scanner's third-party components against a packet's vendor labels.
 *
 * Predictions count when one of their locations is in the manifest scope. A gold vendor is
 * a hit when the scanner reports it (by subject key or alias) with at least one location in
 * a file the label cites; it is a vendor hit when reported anywhere. Precision is vendor
 * level: reported in-scope vendors that are gold, over all reported in-scope vendors.
 * Declared-only vendors are left out of both sides and listed apart.
 */
export function scoreThirdPartyVendors(
  labels: ThirdPartyLabelsFile,
  predictions: PredictedVendor[],
  manifest: BenchmarkManifest,
  options: { reviewStates?: ReviewState[] } = {},
): ThirdPartyScore {
  const states = new Set(options.reviewStates ?? ["accepted", "proposed", "needs_adjudication"]);
  const counted = labels.vendors.filter((label) => states.has(label.review_state));
  const gold = counted.filter((label) => label.sends_data);
  const declared = counted.filter((label) => !label.sends_data);

  const predictedByKey = new Map<string, ThirdPartyLocation[]>();
  for (const prediction of predictions) {
    const inScope = prediction.locations.filter((loc) => isInManifestScope(loc.file_path, manifest));
    if (inScope.length === 0) {
      continue;
    }
    const list = predictedByKey.get(prediction.key) ?? [];
    list.push(...prediction.locations.map((loc) => ({ ...loc, file_path: normalizePath(loc.file_path) })));
    predictedByKey.set(prediction.key, list);
  }

  const declaredKeys = new Set(declared.flatMap(vendorKeys));
  const goldKeys = new Set(gold.flatMap(vendorKeys));

  let hits = 0;
  let vendorHits = 0;
  const misses: VendorMiss[] = [];
  for (const label of gold) {
    const locations = vendorKeys(label).flatMap((key) => predictedByKey.get(key) ?? []);
    if (locations.length === 0) {
      misses.push({
        subject_key: label.subject_key,
        route: label.route,
        cause: label.route === "raw_http" ? "raw_http_missed" : "no_sdk_mapping",
        uncertain: label.uncertain,
      });
      continue;
    }
    vendorHits += 1;
    const files = provenanceFiles(label);
    if (locations.some((loc) => files.has(loc.file_path))) {
      hits += 1;
    } else {
      misses.push({
        subject_key: label.subject_key,
        route: label.route,
        cause: "provenance_wrong",
        uncertain: label.uncertain,
      });
    }
  }

  const scoredPredictions = [...predictedByKey.keys()].filter((key) => !declaredKeys.has(key) || goldKeys.has(key));
  const falsePositives = scoredPredictions.filter((key) => !goldKeys.has(key)).sort();
  const truePositiveVendors = new Set(
    gold
      .filter((label) => vendorKeys(label).some((key) => predictedByKey.has(key)))
      .map((label) => label.subject_key),
  );
  const predictedVendors = truePositiveVendors.size + falsePositives.length;

  const missesByCause: Record<VendorMissCause, number> = {
    no_sdk_mapping: 0,
    raw_http_missed: 0,
    provenance_wrong: 0,
  };
  for (const miss of misses) {
    missesByCause[miss.cause] += 1;
  }

  const certain = gold.filter((label) => !label.uncertain);
  const missed = new Set(misses.map((miss) => miss.subject_key));
  const certainHits = certain.filter((label) => !missed.has(label.subject_key)).length;

  return {
    goldVendors: gold.length,
    certainGoldVendors: certain.length,
    certainHits,
    certainRecall: rate(certainHits, certain.length),
    predictedVendors,
    vendorHits,
    hits,
    recall: rate(hits, gold.length),
    vendorRecall: rate(vendorHits, gold.length),
    precision: rate(truePositiveVendors.size, predictedVendors),
    misses,
    missesByCause,
    falsePositives,
    declaredOnly: declared.map((label) => ({
      subject_key: label.subject_key,
      reported: vendorKeys(label).some((key) => predictedByKey.has(key)),
    })),
  };
}
