import path from "path";

import type { DataFlowType } from "../../../../src/core/types/data-flow";
import { parseComponentEndpointKey } from "../../../../src/eval/canonical/graph/endpoints";
import type {
  AssertedFlowEndpoints,
  TypedComponentEndpoint,
} from "../../../../src/eval/canonical/graph/types";
import type { FlowAssertion } from "../../../../src/eval/canonical/types";
import { loadAnnotations } from "../../../benchmark/manifest";
import { resolveDefaultBenchmarkRoot } from "../../../benchmark/paths";
import { listBenchmarkRepoKeys } from "../../../benchmark/run-benchmark";
import type {
  AnnotationEvidence,
  AnnotationRecord,
  FlowAnnotationCandidate,
  FlowCandidateConfidence,
  FlowCandidateEndpoint,
  FlowDispositionCandidate,
} from "../../../benchmark/schema";
import { annotationRecordToLegacyInput } from "./adapters";
import { loadLegacyGoldRecord } from "./loader";

export const FLOW_MIGRATION_TASK = "KDATAP-8e7756";

export interface FlowMigrationLedgerEntry {
  annotationId: string;
  repoKey: string;
  legacySubjectKey: string;
  expectedStatus: string;
  dispositionCandidate: FlowDispositionCandidate;
  candidateConfidence: FlowCandidateConfidence;
  candidateIdentityKey?: string;
  proposedFlowType?: string;
  sourceEntityId?: string;
  targetEntityId?: string;
  overlapComponentIds: string[];
  rationaleComponentIds: string[];
  loaderDisposition: string;
}

export interface FlowMigrationLedger {
  task: typeof FLOW_MIGRATION_TASK;
  migratedAt: string;
  totalRows: number;
  buckets: Record<FlowDispositionCandidate, number>;
  confidence: Record<FlowCandidateConfidence, number>;
  entries: FlowMigrationLedgerEntry[];
}

export interface FlowCensusRow {
  annotationId: string;
  repoKey: string;
  legacySubjectKey: string;
  expectedStatus: string;
  labels: string[];
  reviewState: string;
  hasCandidate: boolean;
  dispositionCandidate?: FlowDispositionCandidate;
}

export interface FlowCensus {
  task: typeof FLOW_MIGRATION_TASK;
  censusAt: string;
  totalRows: number;
  distinctKeys: number;
  acceptedReviewState: number;
  needsAdjudicationReviewState: number;
  rows: FlowCensusRow[];
}

export function evidenceSpansOverlap(
  a: Pick<AnnotationEvidence, "file_path" | "start_line" | "end_line">,
  b: Pick<AnnotationEvidence, "file_path" | "start_line" | "end_line">,
): boolean {
  if (a.file_path !== b.file_path) {
    return false;
  }
  return a.start_line <= b.end_line && b.start_line <= a.end_line;
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "_");
}

export function parseProseFlowKey(
  key: string,
): { sourceSlug: string; targetSlug: string } | null {
  const trimmed = key.trim();
  if (!trimmed.startsWith("flow:")) {
    return null;
  }
  const body = trimmed.slice("flow:".length);
  const arrow = body.indexOf("->");
  if (arrow <= 0) {
    return null;
  }
  return {
    sourceSlug: body.slice(0, arrow).toLowerCase(),
    targetSlug: body.slice(arrow + 2).toLowerCase(),
  };
}

export function rationaleExplicitlyNamesComponent(
  rationale: string,
  component: AnnotationRecord,
): boolean {
  const text = rationale.toLowerCase();
  const key = component.subject.key.toLowerCase();
  const keyRest = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
  const name = component.subject.name?.toLowerCase() ?? "";
  const identity = component.canonical?.identity_key.toLowerCase() ?? "";
  const identityRest = identity.includes(":")
    ? identity.slice(identity.indexOf(":") + 1)
    : identity;

  for (const token of [keyRest, name, identityRest]) {
    if (token.length >= 3 && text.includes(token)) {
      return true;
    }
  }
  return false;
}

export function listAcceptedComponentsWithCanonical(
  repoDir: string,
): AnnotationRecord[] {
  return loadAnnotations(repoDir, "components").filter(
    (row) => row.provenance.review_state === "accepted" && row.canonical !== undefined,
  );
}

export function listComponentCandidatesForFlow(
  flow: AnnotationRecord,
  components: AnnotationRecord[],
): { overlap: AnnotationRecord[]; rationale: AnnotationRecord[]; all: AnnotationRecord[] } {
  const overlap: AnnotationRecord[] = [];
  const rationale: AnnotationRecord[] = [];
  const seen = new Set<string>();

  for (const component of components) {
    const overlaps = evidenceSpansOverlap(flow.evidence, component.evidence);
    const rationaleSameFile =
      flow.evidence.file_path === component.evidence.file_path &&
      rationaleExplicitlyNamesComponent(flow.rationale, component);

    if (overlaps) {
      overlap.push(component);
    }
    if (rationaleSameFile) {
      rationale.push(component);
    }
    if ((overlaps || rationaleSameFile) && !seen.has(component.id)) {
      seen.add(component.id);
    }
  }

  const all: AnnotationRecord[] = [];
  const allSeen = new Set<string>();
  for (const component of [...overlap, ...rationale]) {
    if (!allSeen.has(component.id)) {
      allSeen.add(component.id);
      all.push(component);
    }
  }

  return { overlap, rationale, all };
}

function componentMatchTokens(component: AnnotationRecord): string[] {
  const tokens: string[] = [];
  const key = component.subject.key.toLowerCase();
  if (key.includes(":")) {
    tokens.push(key.slice(key.indexOf(":") + 1));
  } else {
    tokens.push(key);
  }
  if (component.subject.name) {
    tokens.push(component.subject.name.toLowerCase());
  }
  if (component.canonical?.identity_key) {
    const identity = component.canonical.identity_key.toLowerCase();
    tokens.push(identity.includes(":") ? identity.slice(identity.indexOf(":") + 1) : identity);
  }
  tokens.push(component.id.toLowerCase());
  return tokens.map(normalizeSlug).filter((token) => token.length >= 2);
}

export function slugMatchesComponent(slug: string, component: AnnotationRecord): boolean {
  const normalizedSlug = normalizeSlug(slug);
  return componentMatchTokens(component).some((token) => {
    return token === normalizedSlug || token.includes(normalizedSlug) || normalizedSlug.includes(token);
  });
}

export function rationaleMentionsSlug(rationale: string, slug: string): boolean {
  const text = rationale.toLowerCase();
  const normalized = normalizeSlug(slug);
  const variants = [normalized, normalized.replace(/_/g, " "), normalized.replace(/_/g, "-")];
  return variants.some((variant) => variant.length >= 3 && text.includes(variant));
}

type SideResolution =
  | { kind: "resolved"; component: AnnotationRecord }
  | { kind: "ambiguous" }
  | { kind: "unresolved" };

export function resolveFlowSide(
  slug: string,
  candidates: AnnotationRecord[],
  rationale: string,
): SideResolution {
  let matched = candidates.filter((component) => slugMatchesComponent(slug, component));

  if (matched.length === 0) {
    matched = candidates.filter((component) => rationaleMentionsSlug(rationale, slug));
  }

  if (matched.length === 0) {
    return { kind: "unresolved" };
  }
  if (matched.length === 1) {
    return { kind: "resolved", component: matched[0]! };
  }

  const exactIdentityMatches = matched.filter((component) => {
    const identityRest = component.canonical!.identity_key.includes(":")
      ? component.canonical!.identity_key.slice(component.canonical!.identity_key.indexOf(":") + 1)
      : component.canonical!.identity_key;
    return normalizeSlug(identityRest) === normalizeSlug(slug);
  });
  if (exactIdentityMatches.length === 1) {
    return { kind: "resolved", component: exactIdentityMatches[0]! };
  }

  const identityKeys = new Set(matched.map((component) => component.canonical!.identity_key));
  if (identityKeys.size === 1) {
    return { kind: "ambiguous" };
  }

  return { kind: "ambiguous" };
}

function componentToTypedEndpoint(component: AnnotationRecord): TypedComponentEndpoint {
  const identityKey = component.canonical!.identity_key;
  const parsed = parseComponentEndpointKey(identityKey);
  if (!parsed) {
    throw new Error(`Component identity key is not typed: ${identityKey}`);
  }
  const endpoint: TypedComponentEndpoint = {
    ...parsed,
    componentSubtype: component.canonical!.component_subtype,
  };
  if (component.canonical!.vendor) {
    endpoint.optionalAssertion = { vendor: component.canonical!.vendor };
  }
  return endpoint;
}

export function serializeFlowCandidateEndpoint(
  endpoint: TypedComponentEndpoint,
): FlowCandidateEndpoint {
  const serialized: FlowCandidateEndpoint = {
    component_type: endpoint.componentType,
    endpoint_key: endpoint.endpointKey,
  };
  if (endpoint.componentSubtype) {
    serialized.component_subtype = endpoint.componentSubtype;
  }
  if (endpoint.optionalAssertion?.vendor) {
    serialized.vendor = endpoint.optionalAssertion.vendor;
  }
  return serialized;
}

export function deserializeFlowCandidateEndpoint(
  endpoint: FlowCandidateEndpoint,
): TypedComponentEndpoint {
  const parsed: TypedComponentEndpoint = {
    componentType: endpoint.component_type,
    endpointKey: endpoint.endpoint_key,
  };
  if (endpoint.component_subtype) {
    parsed.componentSubtype = endpoint.component_subtype;
  }
  if (endpoint.vendor) {
    parsed.optionalAssertion = { vendor: endpoint.vendor };
  }
  return parsed;
}

export function candidateEndpointsToAsserted(
  candidate: FlowAnnotationCandidate,
): AssertedFlowEndpoints | undefined {
  if (!candidate.endpoints) {
    return undefined;
  }
  return {
    source: deserializeFlowCandidateEndpoint(candidate.endpoints.source),
    target: deserializeFlowCandidateEndpoint(candidate.endpoints.target),
  };
}

const FLOW_TYPE_PATTERNS: Array<{ type: DataFlowType; patterns: RegExp[] }> = [
  {
    type: "api_call",
    patterns: [
      /\bfetch\b/i,
      /\bhttp/i,
      /\brest\b/i,
      /\brequests?\./i,
      /\.get\s*\(/i,
      /\.post\s*\(/i,
      /\bapi\./i,
      /\bcurl\b/i,
    ],
  },
  {
    type: "database_query",
    patterns: [
      /\bsql\b/i,
      /\borm\b/i,
      /\bpersist/i,
      /\bdatabase\b/i,
      /\bwpdb\b/i,
      /\binsert\b/i,
      /\bupdate\b/i,
      /\bsave\b/i,
      /\bquery\b/i,
      /\brepository\b/i,
      /\bcharfield\b/i,
      /\btable\b/i,
      /\bcolumn\b/i,
    ],
  },
  {
    type: "message_queue",
    patterns: [/\bqueue\b/i, /\btopic\b/i, /\bkafka\b/i, /\brabbitmq\b/i, /\bsqs\b/i],
  },
  {
    type: "file_transfer",
    patterns: [/\bupload\b/i, /\bdownload\b/i, /\bfile\b/i, /\bstorage\b/i],
  },
  {
    type: "webhook",
    patterns: [/\bwebhook\b/i],
  },
  {
    type: "rpc",
    patterns: [/\bgrpc\b/i, /\brpc\b/i],
  },
];

const DATA_CATEGORY_PATTERNS: Array<{ category: string; patterns: RegExp[] }> = [
  { category: "password", patterns: [/\bpassword\b/i, /\bpasswd\b/i, /\bhash\b/i] },
  { category: "email", patterns: [/\bemail\b/i] },
  { category: "access_token", patterns: [/\baccess_token\b/i, /\bid_token\b/i, /\btoken\b/i] },
  { category: "session", patterns: [/\bsession\b/i, /\bcookie\b/i] },
  {
    category: "social_security_number",
    patterns: [/\bssn\b/i, /social_security/i],
  },
  { category: "phone_number", patterns: [/\bphone\b/i] },
  { category: "address", patterns: [/\baddress\b/i] },
  { category: "payment_card", patterns: [/\bcard\b/i, /\bstripe\b/i, /\bpayment\b/i] },
];

function inferFlowType(flow: AnnotationRecord): DataFlowType | undefined {
  const text = `${flow.rationale} ${flow.subject.name ?? ""}`;
  for (const entry of FLOW_TYPE_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.type;
    }
  }
  return undefined;
}

function inferDataCategories(flow: AnnotationRecord): string[] | undefined {
  const text = `${flow.rationale} ${flow.subject.name ?? ""}`;
  const categories = DATA_CATEGORY_PATTERNS.filter((entry) =>
    entry.patterns.some((pattern) => pattern.test(text)),
  ).map((entry) => entry.category);
  return categories.length > 0 ? categories : undefined;
}

function unresolvedCandidate(notes: string): FlowAnnotationCandidate {
  return {
    kind: "flow",
    disposition_candidate: "unresolved",
    candidate_confidence: "low",
    candidate_notes: notes,
  };
}

export function proposeFlowCandidate(
  flow: AnnotationRecord,
  components: AnnotationRecord[],
): FlowAnnotationCandidate {
  if (flow.expected.status === "negative") {
    return {
      kind: "flow",
      disposition_candidate: "rejection",
      candidate_confidence: "high",
      candidate_notes: flow.rationale,
    };
  }

  const parsedKey = parseProseFlowKey(flow.subject.key);
  if (!parsedKey) {
    return unresolvedCandidate(`Could not parse prose flow key '${flow.subject.key}'.`);
  }

  const { overlap, rationale, all: candidates } = listComponentCandidatesForFlow(flow, components);
  const sourceSide = resolveFlowSide(parsedKey.sourceSlug, candidates, flow.rationale);
  const targetSide = resolveFlowSide(parsedKey.targetSlug, candidates, flow.rationale);

  if (sourceSide.kind !== "resolved" || targetSide.kind !== "resolved") {
    if (candidates.length === 1) {
      return {
        kind: "flow",
        disposition_candidate: "intra_component_lineage",
        candidate_confidence: overlap.length > 0 ? "medium" : "low",
        candidate_notes:
          `Single component candidate (${candidates[0]!.id}); prose endpoints ` +
          `${parsedKey.sourceSlug}->${parsedKey.targetSlug} appear intra-component.`,
        source_entity_id: candidates[0]!.canonical!.entity_id,
      };
    }

    const notes: string[] = [];
    if (sourceSide.kind === "ambiguous") {
      notes.push(`ambiguous source match for slug '${parsedKey.sourceSlug}'`);
    } else if (sourceSide.kind === "unresolved") {
      notes.push(`unresolved source for slug '${parsedKey.sourceSlug}'`);
    }
    if (targetSide.kind === "ambiguous") {
      notes.push(`ambiguous target match for slug '${parsedKey.targetSlug}'`);
    } else if (targetSide.kind === "unresolved") {
      notes.push(`unresolved target for slug '${parsedKey.targetSlug}'`);
    }
    if (candidates.length === 0) {
      notes.push("no component candidates via overlap or rationale+same-file");
    }
    return unresolvedCandidate(notes.join("; "));
  }

  const source = sourceSide.component;
  const target = targetSide.component;

  if (source.canonical!.entity_id === target.canonical!.entity_id) {
    return {
      kind: "flow",
      disposition_candidate: "intra_component_lineage",
      candidate_confidence: "medium",
      candidate_notes:
        `Source and target resolve to the same component entity (${source.id}); ` +
        "preserved as transformation evidence, not a headline graph edge.",
      source_entity_id: source.canonical!.entity_id,
      target_entity_id: target.canonical!.entity_id,
    };
  }

  const sourceEndpoint = componentToTypedEndpoint(source);
  const targetEndpoint = componentToTypedEndpoint(target);
  const candidateIdentityKey = `flow:${source.canonical!.identity_key}->${target.canonical!.identity_key}`;
  const confidence: FlowCandidateConfidence =
    overlap.length >= 2 || (overlap.length >= 1 && rationale.length >= 1) ? "high" : "medium";

  return {
    kind: "flow",
    disposition_candidate: "graph_edge",
    candidate_confidence: confidence,
    candidate_notes:
      `Proposed graph edge ${candidateIdentityKey} from component gold ` +
      `(source=${source.id}, target=${target.id}).`,
    candidate_identity_key: candidateIdentityKey,
    proposed_flow_type: inferFlowType(flow),
    proposed_data_categories: inferDataCategories(flow),
    source_entity_id: source.canonical!.entity_id,
    target_entity_id: target.canonical!.entity_id,
    endpoints: {
      source: serializeFlowCandidateEndpoint(sourceEndpoint),
      target: serializeFlowCandidateEndpoint(targetEndpoint),
    },
  };
}

export function buildFlowMigrationLedgerEntry(
  repoKey: string,
  flow: AnnotationRecord,
  candidate: FlowAnnotationCandidate,
  overlapIds: string[],
  rationaleIds: string[],
): FlowMigrationLedgerEntry {
  const { record } = loadLegacyGoldRecord(annotationRecordToLegacyInput(flow), {
    warn: () => undefined,
    repoKey,
  });

  return {
    annotationId: flow.id,
    repoKey,
    legacySubjectKey: flow.subject.key,
    expectedStatus: flow.expected.status,
    dispositionCandidate: candidate.disposition_candidate,
    candidateConfidence: candidate.candidate_confidence,
    candidateIdentityKey: candidate.candidate_identity_key,
    proposedFlowType: candidate.proposed_flow_type,
    sourceEntityId: candidate.source_entity_id,
    targetEntityId: candidate.target_entity_id,
    overlapComponentIds: overlapIds,
    rationaleComponentIds: rationaleIds,
    loaderDisposition: record.disposition,
  };
}

export function listAllDataFlowAnnotations(
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): Array<{ repoKey: string; record: AnnotationRecord }> {
  const rows: Array<{ repoKey: string; record: AnnotationRecord }> = [];
  for (const repoKey of listBenchmarkRepoKeys(benchmarkRoot)) {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    for (const record of loadAnnotations(repoDir, "data_flows")) {
      rows.push({ repoKey, record });
    }
  }
  return rows;
}

export function buildFlowMigrationLedger(
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): FlowMigrationLedger {
  const entries: FlowMigrationLedgerEntry[] = [];
  const buckets: Record<FlowDispositionCandidate, number> = {
    graph_edge: 0,
    intra_component_lineage: 0,
    rejection: 0,
    unresolved: 0,
  };
  const confidence: Record<FlowCandidateConfidence, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const { repoKey, record } of listAllDataFlowAnnotations(benchmarkRoot)) {
    const repoDir = path.join(benchmarkRoot, "repos", repoKey);
    const components = listAcceptedComponentsWithCanonical(repoDir);
    const { overlap, rationale } = listComponentCandidatesForFlow(record, components);
    const candidate = proposeFlowCandidate(record, components);
    entries.push(
      buildFlowMigrationLedgerEntry(
        repoKey,
        record,
        candidate,
        overlap.map((component) => component.id),
        rationale.map((component) => component.id),
      ),
    );
    buckets[candidate.disposition_candidate] += 1;
    confidence[candidate.candidate_confidence] += 1;
  }

  return {
    task: FLOW_MIGRATION_TASK,
    migratedAt: new Date().toISOString(),
    totalRows: entries.length,
    buckets,
    confidence,
    entries,
  };
}

export function buildFlowCensus(
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): FlowCensus {
  const rows: FlowCensusRow[] = [];
  let acceptedReviewState = 0;
  let needsAdjudicationReviewState = 0;
  const keys = new Set<string>();

  for (const { repoKey, record } of listAllDataFlowAnnotations(benchmarkRoot)) {
    keys.add(record.subject.key);
    if (record.provenance.review_state === "accepted") {
      acceptedReviewState += 1;
    }
    if (record.provenance.review_state === "needs_adjudication") {
      needsAdjudicationReviewState += 1;
    }
    rows.push({
      annotationId: record.id,
      repoKey,
      legacySubjectKey: record.subject.key,
      expectedStatus: record.expected.status,
      labels: [...record.expected.labels],
      reviewState: record.provenance.review_state,
      hasCandidate: record.candidate !== undefined,
      dispositionCandidate: record.candidate?.disposition_candidate,
    });
  }

  return {
    task: FLOW_MIGRATION_TASK,
    censusAt: new Date().toISOString(),
    totalRows: rows.length,
    distinctKeys: keys.size,
    acceptedReviewState,
    needsAdjudicationReviewState,
    rows,
  };
}

export function flowCandidateToFlowAssertion(
  candidate: FlowAnnotationCandidate,
): FlowAssertion | undefined {
  if (!candidate.proposed_data_categories || candidate.proposed_data_categories.length === 0) {
    return undefined;
  }
  return {
    dataCategories: candidate.proposed_data_categories,
    supportingProvenance: ["KDATAP-8e7756-candidate"],
  };
}
