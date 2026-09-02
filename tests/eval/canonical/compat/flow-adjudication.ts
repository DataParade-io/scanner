import fs from "fs";
import path from "path";

import type { DataFlowType } from "../../../../src/core/types/data-flow";
import { loadBenchmarkManifest } from "../../../benchmark/manifest";
import { resolveDefaultBenchmarkRoot } from "../../../benchmark/paths";
import type {
  AnnotationRecord,
  FlowAnnotationCandidate,
  FlowCandidateConfidence,
  FlowDispositionCandidate,
} from "../../../benchmark/schema";
import {
  sha256Hex,
  type AdjudicationConfidence,
  type AdjudicationDisposition,
} from "./data-item-adjudication";
import {
  listAcceptedComponentsWithCanonical,
  listAllDataFlowAnnotations,
  listComponentCandidatesForFlow,
  proposeFlowCandidate,
  serializeFlowCandidateEndpoint,
} from "./flow-migration";
import { parseComponentEndpointKey } from "../../../../src/eval/canonical/graph/endpoints";
import type { TypedComponentEndpoint } from "../../../../src/eval/canonical/graph/types";

export const FLOW_ADJUDICATION_TASK =
  "KDATAP-47e33169-a94a-43f6-91c5-7afe1d8217da";

export const ACCEPT_CEILING = 200;

export type FlowEvidenceValidation = "verified" | "unverified" | "contradicted" | "skipped";

export type FlowAdjudicationSourceBucket =
  | "rejection"
  | "graph_edge"
  | "intra_overlap_same_entity"
  | "intra_overlap_cross_entity"
  | "intra_single_component"
  | "intra_low_rationale_only"
  | "entity_picker_resolved"
  | "unresolved";

export interface FlowAdjudicationLedgerEntry {
  annotationId: string;
  repoKey: string;
  sourceBucket: FlowAdjudicationSourceBucket;
  migrationBucket: FlowDispositionCandidate;
  migrationConfidence: FlowCandidateConfidence;
  disposition: AdjudicationDisposition;
  confidence: AdjudicationConfidence;
  finalDispositionCandidate?: FlowDispositionCandidate;
  sourceEntityId?: string;
  targetEntityId?: string;
  candidateIdentityKey?: string;
  proposedFlowType?: string;
  proposedDataCategories?: string[];
  candidate?: FlowAnnotationCandidate;
  evidenceValidation: FlowEvidenceValidation;
  evidenceSpanHash: string;
  overlapComponentIds: string[];
  rationaleComponentIds: string[];
  rationale: string;
  contested: boolean;
}

export interface FlowAdjudicationLedger {
  task: typeof FLOW_ADJUDICATION_TASK;
  totalRows: number;
  acceptCeiling: number;
  dispositions: Record<AdjudicationDisposition, number>;
  bySourceBucket: Record<string, Record<AdjudicationDisposition, number>>;
  contestedCount: number;
  entries: FlowAdjudicationLedgerEntry[];
}

const ORM_PATTERNS = [
  /models\./i,
  /CharField/i,
  /TextField/i,
  /IntegerField/i,
  /Column\s*\(/i,
  /@Column/i,
  /db\.Column/i,
  /ForeignKey/i,
  /Model\s*\)/i,
  /class\s+\w+\([^)]*Model/i,
  /Schema::/i,
  /protected\s+\$/i,
];

const PERSISTENCE_PATTERNS = [
  /\.save\s*\(/i,
  /\.create\s*\(/i,
  /\.insert/i,
  /\.update\s*\(/i,
  /wp_insert_user/i,
  /wp_hash_password/i,
  /persist/i,
  /INSERT INTO/i,
  /UPDATE\s+/i,
];

const CROSS_BOUNDARY_PATTERNS = [
  /\bfetch\b/i,
  /\bhttp/i,
  /axios/i,
  /requests\./i,
  /\.get\s*\(/i,
  /\.post\s*\(/i,
  /webhook/i,
  /kafka/i,
  /\bqueue\b/i,
  /\bcurl\b/i,
  /grpc/i,
  /HttpClient/i,
  /wp_remote_/i,
];

const AUTH_FLOW_PATTERNS = [
  /wp_signon/i,
  /wp_set_auth_cookie/i,
  /set_auth_cookie/i,
  /authenticate/i,
  /signon/i,
  /session_token/i,
  /session_tokens/i,
];

const RUNTIME_FLOW_PATTERNS = [
  /\.\w+\s*\(/,
  /->\w+\(/,
  /\$\w+\s*=\s*/,
  /\bawait\s+/,
  /\breturn\s+/,
  ...PERSISTENCE_PATTERNS,
  ...AUTH_FLOW_PATTERNS,
  ...CROSS_BOUNDARY_PATTERNS,
];

const DECLARATION_ONLY_LINE_PATTERNS = [
  /^\s*\w[\w.-]*:\s*[\w.-]+\s*$/,
  /^\s*\w[\w.-]*:\s*$/,
  /^\s*interface\s+\w+/,
  /^\s*(public|private|protected|val|var)\s+\w+/,
  /^\s*function\s+\w+\s*\([^)]*\)\s*\{?\s*$/,
  /^\s*\w+\s+\w+\s*`/,
  /^\s*\w+\s+\w+(\s+\/\/.*)?\s*$/,
  /^\s*\/\//,
  /^\s*\/\*/,
  /^\s*\*\s/,
];

function isCommentOrBlankLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("//") || trimmed.startsWith("#");
}

export function isDeclarationOnlySpan(span: string): boolean {
  const lines = span.split("\n").filter((line) => !isCommentOrBlankLine(line));
  if (lines.length === 0) {
    return true;
  }

  return lines.every((line) =>
    DECLARATION_ONLY_LINE_PATTERNS.some((pattern) => pattern.test(line)),
  );
}

export function hasRuntimeFlowEvidence(span: string, contextSpan: string): boolean {
  const text = `${span}\n${contextSpan}`;
  return (
    !isDeclarationOnlySpan(span) &&
    (RUNTIME_FLOW_PATTERNS.some((pattern) => pattern.test(text)) ||
      ORM_PATTERNS.some((pattern) => pattern.test(text)))
  );
}

const NEGATIVE_EVIDENCE_PATTERNS = [
  /not implemented/i,
  /does not call/i,
  /never calls/i,
  /no flow/i,
  /not a data flow/i,
  /guard clause/i,
  /return false/i,
  /absent/i,
];

const FLOW_TYPE_PATTERNS: Array<{ type: DataFlowType; patterns: RegExp[] }> = [
  {
    type: "api_call",
    patterns: [/\bfetch\b/i, /\bhttp/i, /axios/i, /requests\./i, /\.get\s*\(/i, /\.post\s*\(/i, /wp_remote_/i],
  },
  {
    type: "database_query",
    patterns: [
      /\bsql\b/i,
      /CharField/i,
      /Column\s*\(/i,
      /INSERT/i,
      /UPDATE/i,
      /\.save\s*\(/i,
      /wpdb/i,
      /models\./i,
    ],
  },
  {
    type: "message_queue",
    patterns: [/\bqueue\b/i, /\btopic\b/i, /kafka/i, /rabbitmq/i, /sqs/i],
  },
  {
    type: "file_transfer",
    patterns: [/\bupload\b/i, /\bdownload\b/i, /\bstorage\b/i],
  },
  { type: "webhook", patterns: [/\bwebhook\b/i] },
  { type: "rpc", patterns: [/\bgrpc\b/i, /\brpc\b/i] },
];

const DATA_CATEGORY_PATTERNS: Array<{ category: string; patterns: RegExp[] }> = [
  { category: "password", patterns: [/\bpassword\b/i, /\bpasswd\b/i, /user_pass/i] },
  { category: "email", patterns: [/\bemail\b/i] },
  { category: "access_token", patterns: [/\baccess_token\b/i, /\bid_token\b/i] },
  { category: "session", patterns: [/\bsession\b/i, /\bcookie\b/i] },
  { category: "social_security_number", patterns: [/\bssn\b/i, /social_security/i] },
  { category: "phone_number", patterns: [/\bphone\b/i] },
  { category: "address", patterns: [/\baddress\b/i] },
  { category: "payment_card", patterns: [/\bcard\b/i, /\bpayment\b/i] },
];

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

export function isOrmModelSpan(span: string): boolean {
  return ORM_PATTERNS.some((pattern) => pattern.test(span));
}

export function hasCrossBoundaryEvidence(span: string, contextSpan: string): boolean {
  const text = `${span}\n${contextSpan}`;
  return CROSS_BOUNDARY_PATTERNS.some((pattern) => pattern.test(text));
}

export function validateFlowEvidence(
  span: string,
  contextSpan: string,
  rationale: string,
): FlowEvidenceValidation {
  const text = `${span}\n${contextSpan}`;
  const codeLines = span
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("//") && !line.trim().startsWith("#"));
  if (codeLines.length === 0) {
    return "unverified";
  }

  if (isDeclarationOnlySpan(span)) {
    return "unverified";
  }

  if (
    ORM_PATTERNS.some((pattern) => pattern.test(text)) ||
    PERSISTENCE_PATTERNS.some((pattern) => pattern.test(text)) ||
    AUTH_FLOW_PATTERNS.some((pattern) => pattern.test(text)) ||
    CROSS_BOUNDARY_PATTERNS.some((pattern) => pattern.test(text)) ||
    hasRuntimeFlowEvidence(span, contextSpan)
  ) {
    return "verified";
  }

  const rationaleWords = rationale
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length >= 5);
  const matchedWords = rationaleWords.filter((word) => text.toLowerCase().includes(word));
  if (matchedWords.length >= 2) {
    return "verified";
  }

  return "unverified";
}

function supportsNegativeFlow(span: string, contextSpan: string, rationale: string): boolean {
  const text = `${span}\n${contextSpan}\n${rationale}`.toLowerCase();
  if (NEGATIVE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  return (
    rationale.toLowerCase().includes("not a data flow") ||
    rationale.toLowerCase().includes("no flow") ||
    rationale.toLowerCase().includes("negative") ||
    rationale.toLowerCase().includes("does not") ||
    rationale.toLowerCase().includes("not in ")
  );
}

function inferFlowTypeFromSpan(span: string, contextSpan: string): DataFlowType | undefined {
  const text = `${span}\n${contextSpan}`;
  for (const entry of FLOW_TYPE_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.type;
    }
  }
  return undefined;
}

function inferDataCategoriesFromSpan(span: string, contextSpan: string): string[] | undefined {
  const text = `${span}\n${contextSpan}`;
  const categories = DATA_CATEGORY_PATTERNS.filter((entry) =>
    entry.patterns.some((pattern) => pattern.test(text)),
  ).map((entry) => entry.category);
  return categories.length > 0 ? categories : undefined;
}

export function findComponentsReferencedInSpan(
  span: string,
  components: AnnotationRecord[],
): AnnotationRecord[] {
  const lower = span.toLowerCase();
  return components.filter((component) => {
    if (component.expected.status === "negative") {
      return false;
    }
    const name = component.subject.name?.toLowerCase();
    if (name && name.length >= 3 && lower.includes(name)) {
      return true;
    }
    const keyRest = component.subject.key.includes(":")
      ? component.subject.key.slice(component.subject.key.indexOf(":") + 1)
      : component.subject.key;
    const normalizedKey = keyRest.toLowerCase().replace(/-/g, "_");
    if (normalizedKey.length >= 3 && lower.includes(normalizedKey)) {
      return true;
    }
    const normalizedId = component.id.toLowerCase().replace(/-/g, "_");
    if (normalizedId.length >= 3 && lower.includes(normalizedId)) {
      return true;
    }
    return false;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function componentIdentifierInSpan(span: string, component: AnnotationRecord): boolean {
  const tokens = [
    component.subject.name,
    component.id,
    component.subject.key.includes(":")
      ? component.subject.key.slice(component.subject.key.indexOf(":") + 1)
      : component.subject.key,
  ].filter((token): token is string => Boolean(token && token.length >= 3));

  for (const token of tokens) {
    const pattern = new RegExp(`\\b${escapeRegExp(token)}\\b`);
    if (pattern.test(span)) {
      return true;
    }
  }
  return false;
}

export function findComponentsWithIdentifierInSpan(
  span: string,
  components: AnnotationRecord[],
): AnnotationRecord[] {
  return components.filter(
    (component) =>
      component.expected.status !== "negative" && componentIdentifierInSpan(span, component),
  );
}

function isApiOrServiceComponent(component: AnnotationRecord): boolean {
  const subtype = component.canonical?.component_subtype;
  if (subtype === "api" || subtype === "service") {
    return true;
  }
  const identity = component.canonical?.identity_key ?? "";
  const id = component.id.toLowerCase();
  return identity.includes(":api") || id.includes("-api") || id.includes("-service");
}

function preferServiceComponent(candidates: AnnotationRecord[]): AnnotationRecord | undefined {
  const positive = candidates.filter((component) => component.expected.status !== "negative");
  if (positive.length < 2) {
    return undefined;
  }
  const preferred = positive.filter(isApiOrServiceComponent);
  return preferred.length === 1 ? preferred[0] : undefined;
}

function resolveEntityForPicker(
  overlap: AnnotationRecord[],
  span: string,
  rationale: string,
  components: AnnotationRecord[],
  entityIdHint?: string,
): AnnotationRecord | undefined {
  if (overlap.length === 1) {
    return overlap[0];
  }
  if (overlap.length > 1) {
    if (entityIdHint) {
      const hintMatches = overlap.filter(
        (component) => component.canonical?.entity_id === entityIdHint,
      );
      if (hintMatches.length === 1) {
        return hintMatches[0];
      }
    }
    const preferred = preferServiceComponent(overlap);
    if (preferred) {
      return preferred;
    }
    const idMatches = overlap.filter((component) => rationale.includes(component.id));
    if (idMatches.length === 1) {
      return idMatches[0];
    }
    return undefined;
  }

  const identifierMatches = findComponentsWithIdentifierInSpan(span, components);
  if (!hasRuntimeFlowEvidence(span, "")) {
    return undefined;
  }
  if (identifierMatches.length === 1) {
    return identifierMatches[0];
  }
  if (identifierMatches.length > 1 && entityIdHint) {
    const hintMatches = identifierMatches.filter(
      (component) => component.canonical?.entity_id === entityIdHint,
    );
    if (hintMatches.length === 1) {
      return hintMatches[0];
    }
  }
  return undefined;
}

function pickActorFromOverlap(overlap: AnnotationRecord[]): AnnotationRecord | undefined {
  const actors = overlap.filter((component) => component.canonical?.component_type === "actor");
  if (actors.length === 1) {
    return actors[0];
  }
  if (actors.length > 1) {
    return undefined;
  }
  return overlap[0];
}

export function pickIntraEntity(
  overlap: AnnotationRecord[],
  span: string,
  rationale: string,
  components: AnnotationRecord[],
): AnnotationRecord | undefined {
  if (overlap.length === 1) {
    return overlap[0];
  }

  const spanMatches = findComponentsReferencedInSpan(span, components);
  if (spanMatches.length === 1) {
    return spanMatches[0];
  }

  const rationaleLower = rationale.toLowerCase();
  const rationaleMatches = components.filter((component) => {
    if (component.expected.status === "negative") {
      return false;
    }
    const name = component.subject.name?.toLowerCase();
    return name !== undefined && name.length >= 3 && rationaleLower.includes(name);
  });
  if (rationaleMatches.length === 1) {
    return rationaleMatches[0];
  }

  if (isOrmModelSpan(span)) {
    return pickActorFromOverlap(overlap);
  }

  if (overlap.length >= 2) {
    const positiveOverlap = overlap.filter((component) => component.expected.status !== "negative");
    if (positiveOverlap.length === 1) {
      return positiveOverlap[0];
    }
    const preferred = preferServiceComponent(positiveOverlap);
    if (preferred) {
      return preferred;
    }
  }

  return undefined;
}

export function shouldDemoteOrmGraphEdge(
  span: string,
  overlap: AnnotationRecord[],
  migrationCandidate: FlowAnnotationCandidate,
): AnnotationRecord | undefined {
  if (migrationCandidate.disposition_candidate !== "graph_edge") {
    return undefined;
  }
  if (!isOrmModelSpan(span)) {
    return undefined;
  }
  const positiveOverlap = overlap.filter((component) => component.expected.status !== "negative");
  if (positiveOverlap.length < 2) {
    return undefined;
  }
  return pickActorFromOverlap(positiveOverlap);
}

function buildIntraCandidate(
  component: AnnotationRecord,
  span: string,
  contextSpan: string,
  notes: string,
  confidence: FlowCandidateConfidence,
): FlowAnnotationCandidate {
  const entityId = component.canonical!.entity_id;
  return {
    kind: "flow",
    disposition_candidate: "intra_component_lineage",
    candidate_confidence: confidence,
    candidate_notes: notes,
    source_entity_id: entityId,
    target_entity_id: entityId,
    proposed_flow_type: inferFlowTypeFromSpan(span, contextSpan),
    proposed_data_categories: inferDataCategoriesFromSpan(span, contextSpan),
  };
}

function buildGraphCandidate(
  source: AnnotationRecord,
  target: AnnotationRecord,
  span: string,
  contextSpan: string,
  notes: string,
  confidence: FlowCandidateConfidence,
): FlowAnnotationCandidate {
  const sourceEndpoint = componentToTypedEndpoint(source);
  const targetEndpoint = componentToTypedEndpoint(target);
  return {
    kind: "flow",
    disposition_candidate: "graph_edge",
    candidate_confidence: confidence,
    candidate_notes: notes,
    candidate_identity_key: `flow:${source.canonical!.identity_key}->${target.canonical!.identity_key}`,
    proposed_flow_type: inferFlowTypeFromSpan(span, contextSpan),
    proposed_data_categories: inferDataCategoriesFromSpan(span, contextSpan),
    source_entity_id: source.canonical!.entity_id,
    target_entity_id: target.canonical!.entity_id,
    endpoints: {
      source: serializeFlowCandidateEndpoint(sourceEndpoint),
      target: serializeFlowCandidateEndpoint(targetEndpoint),
    },
  };
}

export function classifyFlowSourceBucket(
  migrationCandidate: FlowAnnotationCandidate,
  overlap: AnnotationRecord[],
  rationale: AnnotationRecord[],
  allCandidates: AnnotationRecord[],
): FlowAdjudicationSourceBucket {
  const bucket = migrationCandidate.disposition_candidate;
  if (bucket === "rejection") {
    return "rejection";
  }
  if (bucket === "unresolved") {
    return "unresolved";
  }
  if (bucket === "graph_edge") {
    return "graph_edge";
  }

  if (migrationCandidate.candidate_confidence === "low" && overlap.length === 0) {
    return "intra_low_rationale_only";
  }

  if (
    migrationCandidate.source_entity_id &&
    migrationCandidate.target_entity_id &&
    migrationCandidate.source_entity_id === migrationCandidate.target_entity_id &&
    overlap.length > 0
  ) {
    return "intra_overlap_same_entity";
  }

  if (overlap.length >= 2) {
    return "intra_overlap_cross_entity";
  }

  if (allCandidates.length === 1) {
    return "intra_single_component";
  }

  if (overlap.length === 1) {
    return "intra_overlap_same_entity";
  }

  return "intra_low_rationale_only";
}

export interface AdjudicateFlowRowInput {
  repoKey: string;
  record: AnnotationRecord;
  components: AnnotationRecord[];
  migrationCandidate: FlowAnnotationCandidate;
  overlap: AnnotationRecord[];
  rationale: AnnotationRecord[];
  allCandidates: AnnotationRecord[];
  span: string;
  contextSpan: string;
}

export function adjudicateFlowRow(input: AdjudicateFlowRowInput): FlowAdjudicationLedgerEntry {
  const {
    repoKey,
    record,
    components,
    migrationCandidate,
    overlap,
    rationale,
    allCandidates,
    span,
    contextSpan,
  } = input;

  const sourceBucket = classifyFlowSourceBucket(
    migrationCandidate,
    overlap,
    rationale,
    allCandidates,
  );
  const evidenceValidation = validateFlowEvidence(span, contextSpan, record.rationale);
  const evidenceSpanHash = sha256Hex(contextSpan);

  const base = {
    annotationId: record.id,
    repoKey,
    sourceBucket,
    migrationBucket: migrationCandidate.disposition_candidate,
    migrationConfidence: migrationCandidate.candidate_confidence,
    evidenceValidation,
    evidenceSpanHash,
    overlapComponentIds: overlap.map((component) => component.id),
    rationaleComponentIds: rationale.map((component) => component.id),
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
    if (migrationCandidate.disposition_candidate === "rejection") {
      const confirmed = supportsNegativeFlow(span, contextSpan, record.rationale);
      return {
        ...base,
        disposition: "reject",
        confidence: confirmed ? "high" : "medium",
        rationale: confirmed
          ? "Source and rationale confirm explicit negative flow case."
          : "Negative corpus label with high-confidence rejection migration proposal.",
      };
    }
    if (supportsNegativeFlow(span, contextSpan, record.rationale)) {
      return {
        ...base,
        disposition: "reject",
        confidence: "high",
        rationale: "Source and rationale confirm explicit negative flow case.",
      };
    }
    if (evidenceValidation === "verified" && !supportsNegativeFlow(span, contextSpan, record.rationale)) {
      return {
        ...base,
        disposition: "unresolved",
        confidence: "low",
        contested: true,
        rationale: "Negative label but source span shows flow-like code; requires human judgment.",
      };
    }
    return {
      ...base,
      disposition: "unresolved",
      confidence: "low",
      rationale: "Negative case without deterministic source confirmation.",
    };
  }

  if (sourceBucket === "unresolved") {
    const entityIdHint =
      record.candidate?.kind === "flow"
        ? record.candidate.source_entity_id ?? migrationCandidate.source_entity_id
        : migrationCandidate.source_entity_id;
    const entity = resolveEntityForPicker(
      overlap,
      span,
      record.rationale,
      components,
      entityIdHint,
    );
    if (entity && evidenceValidation === "verified") {
      const candidate = buildIntraCandidate(
        entity,
        span,
        contextSpan,
        `Entity picker resolved ${entity.id} from span content; negative decoys excluded.`,
        "medium",
      );
      return {
        ...base,
        sourceBucket: "entity_picker_resolved",
        disposition: "accept",
        confidence: "medium",
        finalDispositionCandidate: "intra_component_lineage",
        sourceEntityId: entity.canonical!.entity_id,
        targetEntityId: entity.canonical!.entity_id,
        candidate,
        contested: true,
        rationale: `Span references ${entity.id}; attributed as intra-component lineage.`,
      };
    }
    return {
      ...base,
      disposition: "unresolved",
      confidence: "low",
      rationale: migrationCandidate.candidate_notes,
    };
  }

  if (sourceBucket === "graph_edge") {
    const demotedEntity = shouldDemoteOrmGraphEdge(span, overlap, migrationCandidate);
    if (demotedEntity && evidenceValidation === "verified") {
      const candidate = buildIntraCandidate(
        demotedEntity,
        span,
        contextSpan,
        `ORM demotion: single-class model field span; preserved as intra-component lineage on ${demotedEntity.id}.`,
        "medium",
      );
      return {
        ...base,
        disposition: "accept",
        confidence: "medium",
        finalDispositionCandidate: "intra_component_lineage",
        sourceEntityId: demotedEntity.canonical!.entity_id,
        targetEntityId: demotedEntity.canonical!.entity_id,
        candidate,
        contested: true,
        rationale: `ORM demotion from graph_edge to intra_component_lineage on ${demotedEntity.id}.`,
      };
    }

    if (
      hasCrossBoundaryEvidence(span, contextSpan) &&
      evidenceValidation === "verified" &&
      migrationCandidate.endpoints &&
      migrationCandidate.source_entity_id &&
      migrationCandidate.target_entity_id
    ) {
      const candidate: FlowAnnotationCandidate = {
        ...migrationCandidate,
        proposed_flow_type: inferFlowTypeFromSpan(span, contextSpan) ?? migrationCandidate.proposed_flow_type,
        proposed_data_categories:
          inferDataCategoriesFromSpan(span, contextSpan) ?? migrationCandidate.proposed_data_categories,
      };
      return {
        ...base,
        disposition: "accept",
        confidence: migrationCandidate.candidate_confidence === "high" ? "high" : "medium",
        finalDispositionCandidate: "graph_edge",
        sourceEntityId: migrationCandidate.source_entity_id,
        targetEntityId: migrationCandidate.target_entity_id,
        candidateIdentityKey: migrationCandidate.candidate_identity_key,
        proposedFlowType: candidate.proposed_flow_type,
        proposedDataCategories: candidate.proposed_data_categories,
        candidate,
        contested: migrationCandidate.candidate_confidence !== "high",
        rationale: "Cross-boundary evidence with resolved endpoints supports graph_edge.",
      };
    }

    return {
      ...base,
      disposition: "unresolved",
      confidence: "low",
      rationale: "graph_edge proposal lacks cross-boundary source confirmation.",
    };
  }

  if (sourceBucket === "intra_low_rationale_only") {
    return {
      ...base,
      disposition: "unresolved",
      confidence: "low",
      rationale: "Rationale-only component match without evidence overlap; cannot auto-accept.",
    };
  }

  if (evidenceValidation !== "verified") {
    return {
      ...base,
      disposition: "unresolved",
      confidence: "low",
      rationale: "Flow candidate exists but source span does not verify the flow claim.",
    };
  }

  const entity =
    sourceBucket === "intra_single_component" && allCandidates.length === 1
      ? allCandidates[0]
      : pickIntraEntity(overlap, span, record.rationale, components);
  if (!entity) {
    return {
      ...base,
      disposition: "unresolved",
      confidence: "low",
      contested: sourceBucket === "intra_overlap_cross_entity",
      rationale: "Ambiguous endpoint match for intra-component lineage.",
    };
  }

  if (entity.expected.status === "negative") {
    return {
      ...base,
      disposition: "unresolved",
      confidence: "low",
      contested: true,
      rationale: "Refusing to attribute flow to negative component decoy.",
    };
  }

  const confidence: AdjudicationConfidence =
    sourceBucket === "intra_overlap_same_entity" && overlap.length > 0 ? "high" : "medium";
  const contested =
    confidence !== "high" ||
    sourceBucket === "intra_overlap_cross_entity" ||
    sourceBucket === "intra_single_component";

  const candidate = buildIntraCandidate(
    entity,
    span,
    contextSpan,
    `Accepted intra-component lineage on ${entity.id} (${sourceBucket}).`,
    confidence === "high" ? "high" : "medium",
  );

  return {
    ...base,
    disposition: "accept",
    confidence,
    finalDispositionCandidate: "intra_component_lineage",
    sourceEntityId: entity.canonical!.entity_id,
    targetEntityId: entity.canonical!.entity_id,
    candidate,
    contested,
    rationale: `Source verifies flow claim; intra-component lineage on ${entity.id}.`,
  };
}

function readFlowEvidenceOrSkip(
  repoKey: string,
  commit: string,
  evidence: AnnotationRecord["evidence"],
  benchmarkRoot: string,
  contextLines = 5,
): { span: string; contextSpan: string } | undefined {
  const cacheDir = path.join(benchmarkRoot, ".cache", "repos", `${repoKey}@${commit}`);
  const filePath = path.join(cacheDir, evidence.file_path);
  if (!fs.existsSync(filePath)) {
    return undefined;
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

export function analyzeFlowForAdjudication(
  repoKey: string,
  record: AnnotationRecord,
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): FlowAdjudicationLedgerEntry {
  const manifest = loadBenchmarkManifest(path.join(benchmarkRoot, "repos", repoKey));
  const repoDir = path.join(benchmarkRoot, "repos", repoKey);
  const components = listAcceptedComponentsWithCanonical(repoDir);
  const { overlap, rationale, all: allCandidates } = listComponentCandidatesForFlow(
    record,
    components,
  );
  const migrationCandidate = proposeFlowCandidate(record, components);

  const evidence = readFlowEvidenceOrSkip(repoKey, manifest.commit, record.evidence, benchmarkRoot);
  if (!evidence) {
    const sourceBucket = classifyFlowSourceBucket(
      migrationCandidate,
      overlap,
      rationale,
      allCandidates,
    );
    if (
      record.expected.status === "negative" &&
      migrationCandidate.disposition_candidate === "rejection"
    ) {
      return {
        annotationId: record.id,
        repoKey,
        sourceBucket: "rejection",
        migrationBucket: migrationCandidate.disposition_candidate,
        migrationConfidence: migrationCandidate.candidate_confidence,
        disposition: "reject",
        confidence: "medium",
        evidenceValidation: "skipped",
        evidenceSpanHash: sha256Hex(""),
        overlapComponentIds: overlap.map((component) => component.id),
        rationaleComponentIds: rationale.map((component) => component.id),
        contested: false,
        rationale:
          "Negative corpus label with high-confidence rejection migration proposal; source cache miss.",
      };
    }
    return {
      annotationId: record.id,
      repoKey,
      sourceBucket,
      migrationBucket: migrationCandidate.disposition_candidate,
      migrationConfidence: migrationCandidate.candidate_confidence,
      disposition: "unresolved",
      confidence: "low",
      evidenceValidation: "skipped",
      evidenceSpanHash: sha256Hex(""),
      overlapComponentIds: overlap.map((component) => component.id),
      rationaleComponentIds: rationale.map((component) => component.id),
      contested: false,
      rationale: `Source cache miss for ${repoKey}; evidence validation skipped.`,
    };
  }

  return adjudicateFlowRow({
    repoKey,
    record,
    components,
    migrationCandidate,
    overlap,
    rationale,
    allCandidates,
    span: evidence.span,
    contextSpan: evidence.contextSpan,
  });
}

function emptyDispositionCounts(): Record<AdjudicationDisposition, number> {
  return { accept: 0, reject: 0, unresolved: 0 };
}

export function buildFlowAdjudicationLedger(
  rows: Array<{ repoKey: string; record: AnnotationRecord }> = listAllDataFlowAnnotations(),
  benchmarkRoot: string = resolveDefaultBenchmarkRoot(),
): FlowAdjudicationLedger {
  const dispositions = emptyDispositionCounts();
  const bySourceBucket: Record<string, Record<AdjudicationDisposition, number>> = {};
  let contestedCount = 0;

  const entries = rows.map(({ repoKey, record }) => {
    const entry = analyzeFlowForAdjudication(repoKey, record, benchmarkRoot);
    dispositions[entry.disposition] += 1;
    const bucketCounts = bySourceBucket[entry.sourceBucket] ?? emptyDispositionCounts();
    bucketCounts[entry.disposition] += 1;
    bySourceBucket[entry.sourceBucket] = bucketCounts;
    if (entry.contested) {
      contestedCount += 1;
    }
    return entry;
  });

  return {
    task: FLOW_ADJUDICATION_TASK,
    totalRows: entries.length,
    acceptCeiling: ACCEPT_CEILING,
    dispositions,
    bySourceBucket,
    contestedCount,
    entries,
  };
}

export function assertFlowAcceptCeiling(ledger: FlowAdjudicationLedger): void {
  if (ledger.dispositions.accept > ledger.acceptCeiling) {
    throw new Error(
      `Accept ceiling exceeded: ${ledger.dispositions.accept} accepts > ${ledger.acceptCeiling} limit`,
    );
  }
}
