import fs from "fs";
import path from "path";

import type { AnnotationRecord } from "../../../benchmark/schema";
import { loadBenchmarkManifest } from "../../../benchmark/manifest";
import { resolveDefaultBenchmarkRoot } from "../../../benchmark/paths";
import { tryRuleIdToConceptEntry } from "../../../../src/eval/canonical/concept-map";
import type { AdjudicationDisposition } from "./data-item-adjudication";
import {
  adjudicateFlowRow,
  analyzeFlowForAdjudication,
  hasRuntimeFlowEvidence,
  pickIntraEntity,
  type FlowAdjudicationLedgerEntry,
} from "./flow-adjudication";
import {
  buildComponentEntityIndex,
  buildFlowAnnotationCanonicalBlock,
  listAcceptedComponentsWithCanonical,
  listAllDataFlowAnnotations,
  listComponentCandidatesForFlow,
  proposeFlowCandidate,
} from "./flow-migration";

export const FLOW_ADJUDICATION_SLICE2_TASK = "KDATAP-a7c36b";

const CATEGORY_PATTERN_TO_RULE: Array<{ ruleId: string; patterns: RegExp[] }> = [
  {
    ruleId: "password",
    patterns: [
      /\bpassword\b/i,
      /\bpasswd\b/i,
      /user_pass/i,
      /PasswordField/i,
      /\bHash\b/,
      /bcrypt/i,
      /hash_password/i,
      /password_hash/i,
    ],
  },
  { ruleId: "email", patterns: [] },
  { ruleId: "phone_number", patterns: [/\bphone\b/i] },
  { ruleId: "address", patterns: [] },
  { ruleId: "ssn", patterns: [/\bssn\b/i, /social_security/i] },
  { ruleId: "username", patterns: [/\busername\b/i] },
  { ruleId: "first_name", patterns: [/\bfirst_name\b/i, /\bfirstname\b/i] },
  { ruleId: "last_name", patterns: [/\blast_name\b/i, /\blastname\b/i] },
  { ruleId: "full_name", patterns: [/\bfull_name\b/i, /\bfullname\b/i] },
  { ruleId: "account_number", patterns: [/\baccount_number\b/i] },
];

const UNMAPPABLE_CATEGORY_PATTERNS: RegExp[] = [
  /\baccess_token\b/i,
  /\brefresh_token\b/i,
  /\bid_token\b/i,
  /\bsession_token\b/i,
  /\bauth_token\b/i,
  /\btoken_hash\b/i,
  /\bpayment_card\b/i,
  /\bcard_reference\b/i,
];

const TOKEN_SESSION_CONTEXT_PATTERNS: RegExp[] = [
  /\brefresh_token\b/i,
  /\baccess_token\b/i,
  /\bid_token\b/i,
  /\bsession_token\b/i,
  /\bauth_token\b/i,
  /\bbearer\b/i,
  /\bsession\b/i,
  /\bcookie\b/i,
];

export interface Slice2FlowAdjudicationLedger {
  task: typeof FLOW_ADJUDICATION_SLICE2_TASK;
  totalRows: number;
  dispositions: Record<AdjudicationDisposition, number>;
  bySourceBucket: Record<string, Record<AdjudicationDisposition, number>>;
  contestedCount: number;
  categoryCorrectionCount: number;
  demotedAcceptCount: number;
  entries: FlowAdjudicationLedgerEntry[];
}

function emptyDispositionCounts(): Record<AdjudicationDisposition, number> {
  return { accept: 0, reject: 0, unresolved: 0 };
}

function matchesEmailCategory(text: string): boolean {
  return (
    /\b(?:email|e_mail|pending_email|mail)\b/i.test(text) ||
    /\bemail.?address\b/i.test(text) ||
    /EmailField/i.test(text) ||
    /@/.test(text) ||
    /\.partition\s*\(\s*['"]@['"]\s*\)/.test(text) ||
    /Addressable::IDNA/i.test(text)
  );
}

function matchesPostalAddress(text: string): boolean {
  if (/normalizes?\s*:\s*address/i.test(text) && /@/.test(text)) {
    return false;
  }
  if (matchesEmailCategory(text)) {
    if (!/\b(?:street|postal|billing|shipping|zip_code|address_line|city)\b/i.test(text)) {
      return false;
    }
  }
  if (/\b(?:street|postal|billing.?address|shipping.?address|address_line|zip_code)\b/i.test(text)) {
    return true;
  }
  return (
    /\baddress\b/i.test(text) &&
    !/\bemail.?address\b/i.test(text) &&
    !/EmailField/i.test(text) &&
    !/@/.test(text)
  );
}

function ruleIdMatchesSpan(ruleId: string, text: string, patterns: RegExp[]): boolean {
  if (ruleId === "email") {
    return matchesEmailCategory(text);
  }
  if (ruleId === "address") {
    return matchesPostalAddress(text);
  }
  return patterns.some((pattern) => pattern.test(text));
}

function inferRuleIdsFromSpan(span: string, contextSpan: string, includeContext = false): string[] {
  const text = includeContext ? `${span}\n${contextSpan}` : span;
  const ruleIds: string[] = [];
  for (const entry of CATEGORY_PATTERN_TO_RULE) {
    if (ruleIdMatchesSpan(entry.ruleId, text, entry.patterns)) {
      ruleIds.push(entry.ruleId);
    }
  }
  return [...new Set(ruleIds)];
}

function spanRequiresMappedCategory(span: string, _contextSpan: string): boolean {
  return (
    inferRuleIdsFromSpan(span, _contextSpan, false).length > 0 ||
    UNMAPPABLE_CATEGORY_PATTERNS.some((pattern) => pattern.test(span))
  );
}

function spanHasOnlyUnmappableCategories(span: string, _contextSpan: string): boolean {
  if (inferRuleIdsFromSpan(span, _contextSpan, false).length > 0) {
    return false;
  }
  return UNMAPPABLE_CATEGORY_PATTERNS.some((pattern) => pattern.test(span));
}

function isTokenSessionContext(span: string, contextSpan: string): boolean {
  const text = `${span}\n${contextSpan}`;
  return TOKEN_SESSION_CONTEXT_PATTERNS.some((pattern) => pattern.test(text));
}

const RESET_TOKEN_PATTERNS: RegExp[] = [
  /resetPasswordToken/i,
  /reset_password_token/i,
  /reset-token/i,
  /reset_token/i,
  /forgot.*token/i,
  /destroy.*token/i,
  /recovery_token/i,
];

function isTokenLifecycleFlow(span: string): boolean {
  return /destroy_all/i.test(span) && /token/i.test(span);
}

function shouldBlockPasswordCategory(span: string, contextSpan: string): boolean {
  if (isTokenSessionContext(span, contextSpan)) {
    return true;
  }
  if (isTokenLifecycleFlow(span)) {
    return true;
  }
  if (RESET_TOKEN_PATTERNS.some((pattern) => pattern.test(span))) {
    return true;
  }
  const text = `${span}\n${contextSpan}`;
  if (!RESET_TOKEN_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return !/\b(?:raw_)?password\b\s*[:=]/i.test(span);
}

export function resolveFlowDataCategories(
  span: string,
  contextSpan: string,
): { categories?: string[]; requiresCategory: boolean; unmappableOnly: boolean } {
  const requiresCategory = spanRequiresMappedCategory(span, contextSpan);
  const unmappableOnly = spanHasOnlyUnmappableCategories(span, contextSpan);

  const ruleIds = new Set<string>(inferRuleIdsFromSpan(span, contextSpan, false));

  if (isTokenSessionContext(span, contextSpan) || shouldBlockPasswordCategory(span, contextSpan)) {
    ruleIds.delete("password");
  }

  const leaves: string[] = [];
  for (const ruleId of ruleIds) {
    const entry = tryRuleIdToConceptEntry(ruleId);
    if (!entry) {
      continue;
    }
    leaves.push(entry.conceptLeaf);
  }

  const uniqueLeaves = [...new Set(leaves)];
  return {
    categories: uniqueLeaves.length > 0 ? uniqueLeaves : undefined,
    requiresCategory,
    unmappableOnly,
  };
}

function readEvidenceSpan(
  repoKey: string,
  record: AnnotationRecord,
  benchmarkRoot: string,
): { span: string; contextSpan: string } | undefined {
  const manifest = loadBenchmarkManifest(path.join(benchmarkRoot, "repos", repoKey));
  const cacheDir = path.join(benchmarkRoot, ".cache", "repos", `${repoKey}@${manifest.commit}`);
  const filePath = path.join(cacheDir, record.evidence.file_path);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const start = Math.max(1, record.evidence.start_line);
  const end = Math.min(lines.length, record.evidence.end_line);
  const contextStart = Math.max(1, start - 5);
  const contextEnd = Math.min(lines.length, end + 5);
  return {
    span: lines.slice(start - 1, end).join("\n"),
    contextSpan: lines.slice(contextStart - 1, contextEnd).join("\n"),
  };
}

function canPromoteToFlowCanonical(
  entry: FlowAdjudicationLedgerEntry,
  repoKey: string,
  benchmarkRoot: string,
): boolean {
  if (!entry.sourceEntityId || !entry.targetEntityId) {
    return false;
  }
  const disposition =
    entry.finalDispositionCandidate ?? entry.candidate?.disposition_candidate ?? "intra_component_lineage";
  const repoDir = path.join(benchmarkRoot, "repos", repoKey);
  const componentIndex = buildComponentEntityIndex(listAcceptedComponentsWithCanonical(repoDir));
  try {
    buildFlowAnnotationCanonicalBlock(
      entry.sourceEntityId,
      entry.targetEntityId,
      disposition,
      componentIndex,
      {
        flowType: entry.candidate?.proposed_flow_type ?? entry.proposedFlowType,
        dataCategories: entry.candidate?.proposed_data_categories ?? entry.proposedDataCategories,
      },
    );
    return true;
  } catch {
    return false;
  }
}

function demoteToUnresolved(
  entry: FlowAdjudicationLedgerEntry,
  rationale: string,
): FlowAdjudicationLedgerEntry {
  return {
    ...entry,
    disposition: "unresolved",
    confidence: "low",
    candidate: undefined,
    finalDispositionCandidate: undefined,
    sourceEntityId: undefined,
    targetEntityId: undefined,
    candidateIdentityKey: undefined,
    proposedFlowType: undefined,
    proposedDataCategories: undefined,
    rationale,
  };
}

function applyCategoryResolution(
  entry: FlowAdjudicationLedgerEntry,
  span: string,
  contextSpan: string,
): { entry: FlowAdjudicationLedgerEntry; categoryCorrected: boolean } {
  if (entry.disposition !== "accept" || !entry.candidate) {
    return { entry, categoryCorrected: false };
  }

  const resolution = resolveFlowDataCategories(span, contextSpan);

  if (resolution.unmappableOnly || !resolution.categories?.length) {
    return {
      entry: demoteToUnresolved(
        entry,
        resolution.unmappableOnly
          ? "Token/session/reset-token fields have no closed concept-map leaf."
          : "Accept requires at least one closed concept-map data category; none resolved from pinned source.",
      ),
      categoryCorrected: false,
    };
  }

  const before = JSON.stringify(entry.candidate.proposed_data_categories ?? []);
  const candidate = {
    ...entry.candidate,
    proposed_data_categories: resolution.categories,
  };
  const after = JSON.stringify(candidate.proposed_data_categories ?? []);
  return {
    entry: {
      ...entry,
      candidate,
      proposedDataCategories: resolution.categories,
    },
    categoryCorrected: before !== after,
  };
}

function retryLowRationaleRow(
  repoKey: string,
  record: AnnotationRecord,
  span: string,
  contextSpan: string,
  benchmarkRoot: string,
): FlowAdjudicationLedgerEntry | undefined {
  const repoDir = path.join(benchmarkRoot, "repos", repoKey);
  const components = listAcceptedComponentsWithCanonical(repoDir);
  const { overlap, rationale, all: allCandidates } = listComponentCandidatesForFlow(record, components);
  const migrationCandidate = proposeFlowCandidate(record, components);

  if (!hasRuntimeFlowEvidence(span, contextSpan)) {
    return undefined;
  }

  const entity =
    allCandidates.length === 1
      ? allCandidates[0]
      : pickIntraEntity(overlap, span, record.rationale, components);
  if (!entity?.canonical || entity.expected.status === "negative") {
    return undefined;
  }

  return adjudicateFlowRow({
    repoKey,
    record,
    components,
    migrationCandidate,
    overlap,
    rationale,
    allCandidates,
    span,
    contextSpan,
  });
}

export function finalizeSlice2FlowEntry(
  entry: FlowAdjudicationLedgerEntry,
  repoKey: string,
  record: AnnotationRecord,
  benchmarkRoot: string,
): { entry: FlowAdjudicationLedgerEntry; categoryCorrected: boolean; demotedAccept: boolean } {
  if (entry.evidenceValidation === "skipped") {
    return {
      entry: demoteToUnresolved(entry, "Source cache miss; slice-2 requires pinned source verification."),
      categoryCorrected: false,
      demotedAccept: entry.disposition === "accept",
    };
  }

  const evidence = readEvidenceSpan(repoKey, record, benchmarkRoot);
  if (!evidence) {
    return {
      entry: demoteToUnresolved(entry, "Source cache miss; slice-2 requires pinned source verification."),
      categoryCorrected: false,
      demotedAccept: entry.disposition === "accept",
    };
  }

  let working = entry;
  if (
    working.disposition === "unresolved" &&
    working.sourceBucket === "intra_low_rationale_only" &&
    working.evidenceValidation === "verified"
  ) {
    const retried = retryLowRationaleRow(
      repoKey,
      record,
      evidence.span,
      evidence.contextSpan,
      benchmarkRoot,
    );
    if (retried && retried.disposition === "accept") {
      working = {
        ...retried,
        sourceBucket: "intra_low_rationale_only",
        contested: true,
        rationale: `Slice-2 retry: runtime evidence with resolved intra-component entity (${retried.rationale})`,
      };
    }
  }

  const categoryResult = applyCategoryResolution(working, evidence.span, evidence.contextSpan);
  working = categoryResult.entry;

  if (working.disposition === "accept") {
    if (!canPromoteToFlowCanonical(working, repoKey, benchmarkRoot)) {
      return {
        entry: demoteToUnresolved(
          working,
          "Accept demoted: source/target entity ids do not resolve to flow_canonical endpoints.",
        ),
        categoryCorrected: categoryResult.categoryCorrected,
        demotedAccept: true,
      };
    }
  }

  return {
    entry: working,
    categoryCorrected: categoryResult.categoryCorrected,
    demotedAccept: entry.disposition === "accept" && working.disposition !== "accept",
  };
}

export function analyzeFlowForSlice2Adjudication(
  repoKey: string,
  record: AnnotationRecord,
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): FlowAdjudicationLedgerEntry {
  const base = analyzeFlowForAdjudication(repoKey, record, benchmarkRoot);
  return finalizeSlice2FlowEntry(base, repoKey, record, benchmarkRoot).entry;
}

export function listUnresolvedFlowRows(
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): Array<{ repoKey: string; record: AnnotationRecord }> {
  return listAllDataFlowAnnotations(benchmarkRoot).filter(
    ({ record }) => record.provenance.review_state === "needs_adjudication",
  );
}

export function buildSlice2FlowAdjudicationLedger(
  rows: Array<{ repoKey: string; record: AnnotationRecord }> = listUnresolvedFlowRows(),
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): Slice2FlowAdjudicationLedger {
  const dispositions = emptyDispositionCounts();
  const bySourceBucket: Record<string, Record<AdjudicationDisposition, number>> = {};
  let contestedCount = 0;
  let categoryCorrectionCount = 0;
  let demotedAcceptCount = 0;

  const entries = rows.map(({ repoKey, record }) => {
    const base = analyzeFlowForAdjudication(repoKey, record, benchmarkRoot);
    const finalized = finalizeSlice2FlowEntry(base, repoKey, record, benchmarkRoot);
    const entry = finalized.entry;

    dispositions[entry.disposition] += 1;
    const bucketCounts = bySourceBucket[entry.sourceBucket] ?? emptyDispositionCounts();
    bucketCounts[entry.disposition] += 1;
    bySourceBucket[entry.sourceBucket] = bucketCounts;
    if (entry.contested) {
      contestedCount += 1;
    }
    if (finalized.categoryCorrected) {
      categoryCorrectionCount += 1;
    }
    if (finalized.demotedAccept) {
      demotedAcceptCount += 1;
    }
    return entry;
  });

  return {
    task: FLOW_ADJUDICATION_SLICE2_TASK,
    totalRows: entries.length,
    dispositions,
    bySourceBucket,
    contestedCount,
    categoryCorrectionCount,
    demotedAcceptCount,
    entries,
  };
}
