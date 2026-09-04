import { stampEnvelope } from "../../../../src/eval/canonical/contract";
import { tryRuleIdToConceptEntry } from "../../../../src/eval/canonical/concept-map";
import type {
  AssertedFlowEndpoints,
  CanonicalDisposition,
  CanonicalGoldExpectation,
  CanonicalLayer,
  FlowAssertion,
  ObservedTokenCandidate,
  OptionalAssertion,
} from "../../../../src/eval/canonical/types";
import type { AnnotationRecord, BenchmarkLayer } from "../../../benchmark/schema";
import {
  buildAcceptedGoldExpectation,
  buildMigrationIncompleteRecord,
  buildNeedsAdjudicationRecord,
} from "../builders";
import {
  candidateEndpointsToAsserted,
  deserializeFlowCandidateEndpoint,
  flowCandidateToFlowAssertion,
} from "../compat/flow-migration";
import {
  classificationIdentityKey,
  resolveComponentSubtype,
} from "../compat/component-taxonomy";
import type { MigrationDiagnostic } from "../compat/types";
import { evalCaseToAnnotationRecord } from "./fixture-input";
import type { EvalCase } from "../../types";

const CORPUS_TO_CANONICAL_LAYER: Record<BenchmarkLayer, CanonicalLayer> = {
  components: "components",
  data_flows: "data-flows",
  data_items: "data-items",
  raw_hits: "raw-hits",
  mentions: "mentions",
  pii_signals: "mentions",
};

export interface LoadCanonicalGoldOptions {
  repoKey?: string;
  adapterMapVersion?: string;
  /** @deprecated No-op — retained for call-site compatibility during compat removal. */
  warn?: (message: string) => void;
}

export interface CanonicalGoldLoadResult {
  record: CanonicalGoldExpectation & { id: string };
  diagnostics: MigrationDiagnostic[];
}

function tokenCandidate(
  value: string,
  evidenceRef: number,
  provenance: string,
): ObservedTokenCandidate {
  return {
    value,
    evidenceRef,
    provenance,
    validationState: "unverified",
  };
}

function parseKeyPrefix(key: string): { prefix: string; rest: string } {
  const separator = key.indexOf(":");
  if (separator === -1) {
    return { prefix: "", rest: key.trim().toLowerCase() };
  }
  return {
    prefix: key.slice(0, separator).trim().toLowerCase(),
    rest: key.slice(separator + 1).trim().toLowerCase(),
  };
}

function resolveCanonicalLayer(layer: BenchmarkLayer): CanonicalLayer {
  return CORPUS_TO_CANONICAL_LAYER[layer];
}

function hasFlowCanonicalEndpoints(record: AnnotationRecord): boolean {
  const endpoints = record.flow_canonical?.endpoints;
  return endpoints?.source !== undefined && endpoints?.target !== undefined;
}

function resolveDisposition(
  record: AnnotationRecord,
  canonicalLayer: CanonicalLayer,
  conceptLeaf: string,
): CanonicalDisposition {
  const { expected, provenance } = record;

  if (expected.status === "ambiguous") {
    return "needs_adjudication";
  }

  if (expected.status === "negative") {
    if (provenance.review_state === "rejected") {
      return "rejected";
    }
    return "needs_adjudication";
  }

  if (provenance.review_state === "rejected") {
    return "rejected";
  }
  if (provenance.review_state === "needs_adjudication") {
    return "needs_adjudication";
  }
  if (provenance.review_state === "proposed") {
    return "needs_adjudication";
  }

  if (canonicalLayer === "data-flows") {
    if (provenance.review_state === "accepted" && hasFlowCanonicalEndpoints(record)) {
      if (!conceptLeaf.trim()) {
        return "migration_incomplete";
      }
      return "accepted";
    }
    return "needs_adjudication";
  }

  if (provenance.review_state === "accepted") {
    if (!conceptLeaf.trim()) {
      return "migration_incomplete";
    }
    return "accepted";
  }

  return "needs_adjudication";
}

interface ResolvedGoldFields {
  identityKey: string;
  conceptLeaf: string;
  conceptAncestry: readonly string[];
  componentType?: string;
  componentSubtype?: string;
  optionalAssertion?: OptionalAssertion;
  entityId?: string;
  flowEndpoints?: AssertedFlowEndpoints;
  flowAssertion?: FlowAssertion;
  observedTokenCandidates: ObservedTokenCandidate[];
  displayText?: string;
}

function resolveMentionOrRawHitIdentity(
  record: AnnotationRecord,
  canonicalLayer: "mentions" | "raw-hits",
): Pick<ResolvedGoldFields, "identityKey" | "conceptLeaf" | "conceptAncestry"> {
  const key = record.subject.key.trim();
  const expectedPrefix = canonicalLayer === "mentions" ? "mention:" : "raw_hit:";

  if (!key.startsWith(expectedPrefix)) {
    throw new Error(
      `canonical gold loader: ${canonicalLayer} layer requires ${expectedPrefix} prefix, got '${key}'`,
    );
  }

  const { rest } = parseKeyPrefix(key);
  const mapped = tryRuleIdToConceptEntry(rest);
  const labelLeaf = record.expected.labels.find(
    (label) => !label.startsWith("legacy-key:"),
  )?.trim();
  const conceptLeaf = mapped?.conceptLeaf ?? labelLeaf ?? rest;
  const conceptAncestry = mapped?.conceptAncestry ?? (labelLeaf ? [labelLeaf] : [rest]);

  return { identityKey: key, conceptLeaf, conceptAncestry };
}

function resolveDataItemIdentity(
  record: AnnotationRecord,
): Pick<ResolvedGoldFields, "identityKey" | "conceptLeaf" | "conceptAncestry" | "observedTokenCandidates"> {
  const key = record.subject.key.trim();
  if (!key.startsWith("data_item:")) {
    throw new Error(
      `canonical gold loader: data-items layer requires data_item: prefix, got '${key}'`,
    );
  }

  const candidate = record.candidate?.kind === "data_item" ? record.candidate : undefined;
  const labelLeaf = record.expected.labels.find(
    (label) => !label.startsWith("legacy-key:"),
  )?.trim();
  const { rest } = parseKeyPrefix(key);
  const conceptLeaf = candidate?.proposed_concept_leaf || labelLeaf || rest;
  const conceptAncestry = candidate?.proposed_ancestry?.length
    ? candidate.proposed_ancestry
    : [conceptLeaf];

  const observedTokenCandidates: ObservedTokenCandidate[] = [];
  if (candidate) {
    observedTokenCandidates.push(
      tokenCandidate(candidate.proposed_identity_key, 0, "data-item-candidate-identity"),
      tokenCandidate(candidate.proposed_concept_leaf, 0, "data-item-candidate-leaf"),
    );
    for (const ancestor of candidate.proposed_ancestry) {
      observedTokenCandidates.push(
        tokenCandidate(ancestor, 0, "data-item-candidate-ancestry"),
      );
    }
    if (candidate.candidate_notes) {
      observedTokenCandidates.push(
        tokenCandidate(candidate.candidate_notes, 0, "data-item-candidate-notes"),
      );
    }
  }

  return {
    identityKey: candidate?.proposed_identity_key || key,
    conceptLeaf,
    conceptAncestry,
    observedTokenCandidates,
  };
}

function resolveComponentIdentity(
  record: AnnotationRecord,
): Pick<
  ResolvedGoldFields,
  | "identityKey"
  | "conceptLeaf"
  | "conceptAncestry"
  | "componentType"
  | "componentSubtype"
  | "optionalAssertion"
  | "entityId"
  | "observedTokenCandidates"
> {
  const legacyKey = record.subject.key.trim();
  const observedTokenCandidates = legacyKey
    ? [tokenCandidate(legacyKey, 0, "legacy-subject-key")]
    : [];

  if (record.canonical) {
    const block = record.canonical;
    const optionalAssertion: OptionalAssertion | undefined = block.vendor
      ? { vendor: block.vendor }
      : undefined;
    return {
      identityKey: block.identity_key,
      componentType: block.component_type,
      componentSubtype: block.component_subtype,
      conceptLeaf: block.component_subtype,
      conceptAncestry: [block.component_subtype],
      entityId: block.entity_id,
      optionalAssertion,
      observedTokenCandidates,
    };
  }

  const { prefix, rest } = parseKeyPrefix(legacyKey);
  const componentType = prefix;
  const componentSubtype = resolveComponentSubtype(
    componentType,
    record.expected.labels,
    rest,
  );
  const identityKey = classificationIdentityKey(componentType, componentSubtype);

  return {
    identityKey,
    componentType,
    componentSubtype,
    conceptLeaf: componentSubtype,
    conceptAncestry: [componentSubtype],
    optionalAssertion: componentType === "third_party" ? { vendor: rest } : undefined,
    observedTokenCandidates,
  };
}

function resolveFlowIdentity(
  record: AnnotationRecord,
): Pick<
  ResolvedGoldFields,
  "identityKey" | "conceptLeaf" | "conceptAncestry" | "flowEndpoints" | "flowAssertion"
> {
  const block = record.flow_canonical;
  if (block && hasFlowCanonicalEndpoints(record)) {
    const conceptLeaf = block.flow_type?.trim() || "data_transfer";
    const flowEndpoints: AssertedFlowEndpoints = {
      source: deserializeFlowCandidateEndpoint(block.endpoints.source),
      target: deserializeFlowCandidateEndpoint(block.endpoints.target),
    };
    const flowAssertion: FlowAssertion | undefined =
      block.data_categories && block.data_categories.length > 0
        ? {
            dataCategories: block.data_categories,
            supportingProvenance: ["KDATAP-7e5b94-flow-canonical"],
          }
        : undefined;

    return {
      identityKey: block.identity_key,
      conceptLeaf,
      conceptAncestry: [conceptLeaf],
      flowEndpoints,
      flowAssertion,
    };
  }

  const candidate = record.candidate?.kind === "flow" ? record.candidate : undefined;
  const key = record.subject.key.trim();
  const { rest } = parseKeyPrefix(key);
  const conceptLeaf = candidate?.proposed_flow_type?.trim() || rest || "data_transfer";
  const flowEndpoints = candidate ? candidateEndpointsToAsserted(candidate) : undefined;
  const flowAssertion = candidate ? flowCandidateToFlowAssertion(candidate) : undefined;

  return {
    identityKey: candidate?.candidate_identity_key || key,
    conceptLeaf,
    conceptAncestry: [conceptLeaf],
    flowEndpoints: flowEndpoints ?? undefined,
    flowAssertion,
  };
}

function appendSubjectNameTokens(
  record: AnnotationRecord,
  canonicalLayer: CanonicalLayer,
  componentType: string | undefined,
  observedTokenCandidates: ObservedTokenCandidate[],
): { observedTokenCandidates: ObservedTokenCandidate[]; displayText?: string } {
  const name = record.subject.name?.trim();
  if (!name) {
    return { observedTokenCandidates };
  }

  let provenance = "legacy-subject-name";
  if (canonicalLayer === "components" && componentType === "third_party") {
    provenance = "legacy-vendor-candidate";
  }

  const tokens = [
    ...observedTokenCandidates,
    tokenCandidate(name, 0, provenance),
  ];

  if (canonicalLayer === "data-flows") {
    return { observedTokenCandidates: tokens, displayText: name };
  }

  return { observedTokenCandidates: tokens };
}

function appendLabelTokens(
  record: AnnotationRecord,
  observedTokenCandidates: ObservedTokenCandidate[],
): ObservedTokenCandidate[] {
  if (record.expected.labels.length === 0) {
    return observedTokenCandidates;
  }

  return [
    ...observedTokenCandidates,
    ...record.expected.labels.map((label) =>
      tokenCandidate(label, 0, "legacy-expected-label"),
    ),
  ];
}

function resolveGoldFields(
  record: AnnotationRecord,
  canonicalLayer: CanonicalLayer,
  options: LoadCanonicalGoldOptions,
): ResolvedGoldFields {
  let partial: ResolvedGoldFields;

  switch (canonicalLayer) {
    case "mentions":
    case "raw-hits": {
      const identity = resolveMentionOrRawHitIdentity(record, canonicalLayer);
      partial = { ...identity, observedTokenCandidates: [] };
      break;
    }
    case "data-items": {
      const identity = resolveDataItemIdentity(record);
      partial = {
        identityKey: identity.identityKey,
        conceptLeaf: identity.conceptLeaf,
        conceptAncestry: identity.conceptAncestry,
        observedTokenCandidates: identity.observedTokenCandidates,
      };
      break;
    }
    case "components": {
      const identity = resolveComponentIdentity(record);
      partial = {
        ...identity,
        observedTokenCandidates: identity.observedTokenCandidates,
      };
      if (!partial.entityId && options.repoKey && record.canonical) {
        partial.entityId = record.canonical.entity_id;
      }
      break;
    }
    case "data-flows": {
      const identity = resolveFlowIdentity(record);
      partial = { ...identity, observedTokenCandidates: [] };
      break;
    }
    default:
      throw new Error(`canonical gold loader: unsupported layer '${canonicalLayer}'`);
  }

  const withName = appendSubjectNameTokens(
    record,
    canonicalLayer,
    partial.componentType,
    partial.observedTokenCandidates,
  );
  partial.observedTokenCandidates = appendLabelTokens(record, withName.observedTokenCandidates);
  if (withName.displayText !== undefined) {
    partial.displayText = withName.displayText;
  }

  return partial;
}

function buildRejectedGoldRecord(
  record: AnnotationRecord,
  fields: ResolvedGoldFields,
  canonicalLayer: CanonicalLayer,
  adapterMapVersion?: string,
): CanonicalGoldExpectation {
  const envelope = stampEnvelope(adapterMapVersion);
  return {
    ...envelope,
    identity: { layer: canonicalLayer, identityKey: fields.identityKey },
    classification: {
      conceptLeaf: fields.conceptLeaf,
      conceptAncestry: fields.conceptAncestry,
      componentType: fields.componentType,
      componentSubtype: fields.componentSubtype,
    },
    optionalAssertion: fields.optionalAssertion,
    evidenceLocations: [
      {
        file_path: record.evidence.file_path,
        start_line: record.evidence.start_line,
        end_line: record.evidence.end_line,
      },
    ],
    observedTokenCandidates:
      fields.observedTokenCandidates.length > 0 ? fields.observedTokenCandidates : undefined,
    display: fields.displayText !== undefined ? { displayText: fields.displayText } : undefined,
    disposition: "rejected",
  };
}

function buildCanonicalRecord(
  record: AnnotationRecord,
  fields: ResolvedGoldFields,
  canonicalLayer: CanonicalLayer,
  disposition: CanonicalDisposition,
  options: LoadCanonicalGoldOptions,
): CanonicalGoldExpectation {
  const base = {
    layer: canonicalLayer,
    identityKey: fields.identityKey,
    conceptLeaf: fields.conceptLeaf,
    conceptAncestry: fields.conceptAncestry,
    componentType: fields.componentType,
    componentSubtype: fields.componentSubtype,
    optionalAssertion: fields.optionalAssertion,
    evidenceLocations: [
      {
        file_path: record.evidence.file_path,
        start_line: record.evidence.start_line,
        end_line: record.evidence.end_line,
      },
    ],
    observedTokenCandidates:
      fields.observedTokenCandidates.length > 0 ? fields.observedTokenCandidates : undefined,
    displayText: fields.displayText,
    adapterMapVersion: options.adapterMapVersion,
    entityId: fields.entityId,
    flowEndpoints: fields.flowEndpoints,
    flowAssertion: fields.flowAssertion,
  };

  switch (disposition) {
    case "accepted":
      return buildAcceptedGoldExpectation(base);
    case "needs_adjudication":
      return buildNeedsAdjudicationRecord(base);
    case "migration_incomplete":
      return buildMigrationIncompleteRecord(base);
    case "rejected":
      return buildRejectedGoldRecord(record, fields, canonicalLayer, options.adapterMapVersion);
    default:
      throw new Error(`Unsupported disposition '${disposition as string}'`);
  }
}

/** Load one corpus annotation row as canonical gold (no legacy conversion). */
export function loadCanonicalGoldFromAnnotation(
  record: AnnotationRecord,
  options: LoadCanonicalGoldOptions = {},
): CanonicalGoldLoadResult {
  const canonicalLayer = resolveCanonicalLayer(record.layer);
  const fields = resolveGoldFields(record, canonicalLayer, options);
  const disposition = resolveDisposition(record, canonicalLayer, fields.conceptLeaf);
  const built = buildCanonicalRecord(record, fields, canonicalLayer, disposition, options);

  return {
    record: { ...built, id: record.id },
    diagnostics: [],
  };
}

/** Jest fixture EvalCase → canonical gold expectation. */
export function loadCanonicalGoldFromEvalCase(
  caseRecord: EvalCase,
  options: LoadCanonicalGoldOptions = {},
): CanonicalGoldLoadResult {
  return loadCanonicalGoldFromAnnotation(evalCaseToAnnotationRecord(caseRecord), options);
}

/** Batch corpus loader for tests and migration accounting. */
export function loadCanonicalGoldFromAnnotations(
  records: AnnotationRecord[],
  options: LoadCanonicalGoldOptions = {},
): CanonicalGoldLoadResult[] {
  return records.map((record) => loadCanonicalGoldFromAnnotation(record, options));
}
