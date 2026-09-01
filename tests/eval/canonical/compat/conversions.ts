import type { BenchmarkLayer } from "../../../benchmark/schema";
import { stampEnvelope } from "../../../../src/eval/canonical/contract";
import {
  buildAcceptedGoldExpectation,
  buildMigrationIncompleteRecord,
  buildNeedsAdjudicationRecord,
} from "../builders";
import type {
  AssertedFlowEndpoints,
  CanonicalDisposition,
  CanonicalGoldExpectation,
  CanonicalLayer,
  FlowAssertion,
  ObservedTokenCandidate,
  OptionalAssertion,
} from "../../../../src/eval/canonical/types";
import {
  CANONICAL_CONTRACT_VERSION,
  LEGACY_SOURCE_CONTRACT_VERSION,
} from "./contract";
import { tryRuleIdToConceptEntry } from "../../../../src/eval/canonical/concept-map";
import {
  buildRepoLocalEntityId,
  classificationIdentityKey,
  resolveComponentSubtype,
} from "./component-taxonomy";
import {
  candidateEndpointsToAsserted,
  flowCandidateToFlowAssertion,
} from "./flow-migration";
import type {
  ConversionKind,
  LegacyGoldRecord,
  LoadLegacyGoldOptions,
  MigrationDiagnostic,
} from "./types";

export interface ConversionState {
  canonicalLayer: CanonicalLayer;
  workingKey: string;
  identityKey: string;
  conceptLeaf: string;
  conceptAncestry: readonly string[];
  componentType?: string;
  componentSubtype?: string;
  optionalAssertion?: OptionalAssertion;
  observedTokenCandidates: ObservedTokenCandidate[];
  displayText?: string;
  disposition: CanonicalDisposition;
  identityAssigned: boolean;
  entityId?: string;
  flowEndpoints?: AssertedFlowEndpoints;
  flowAssertion?: FlowAssertion;
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

function makeDiagnostic(
  annotationId: string,
  conversion: ConversionKind,
  detail: string,
): MigrationDiagnostic {
  return {
    annotationId,
    sourceContractVersion: LEGACY_SOURCE_CONTRACT_VERSION,
    targetContractVersion: CANONICAL_CONTRACT_VERSION,
    conversion,
    detail,
  };
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

const CORPUS_TO_CANONICAL_LAYER: Record<BenchmarkLayer, CanonicalLayer> = {
  components: "components",
  data_flows: "data-flows",
  data_items: "data-items",
  raw_hits: "raw-hits",
  mentions: "mentions",
  pii_signals: "mentions",
};

export function corpusLayerToCanonical(
  input: LegacyGoldRecord,
): { state: Pick<ConversionState, "canonicalLayer">; diagnostic: MigrationDiagnostic } {
  const canonicalLayer = CORPUS_TO_CANONICAL_LAYER[input.layer];
  const detail =
    input.layer === canonicalLayer
      ? `${input.layer} (unchanged)`
      : `${input.layer} → ${canonicalLayer}`;
  return {
    state: { canonicalLayer },
    diagnostic: makeDiagnostic(input.id, "corpus_layer_to_canonical", detail),
  };
}

export function piiSignalPrefixRewrite(
  state: ConversionState,
  annotationId: string,
): { state: Pick<ConversionState, "workingKey">; diagnostic?: MigrationDiagnostic } {
  if (!state.workingKey.startsWith("pii_signal:")) {
    return { state: { workingKey: state.workingKey } };
  }

  const rest = state.workingKey.slice("pii_signal:".length);
  let rewritten: string;
  if (state.canonicalLayer === "mentions") {
    rewritten = `mention:${rest}`;
  } else if (state.canonicalLayer === "raw-hits") {
    rewritten = `raw_hit:${rest}`;
  } else {
    rewritten = state.workingKey;
  }

  return {
    state: { workingKey: rewritten },
    diagnostic: makeDiagnostic(
      annotationId,
      "pii_signal_prefix_rewrite",
      `${state.workingKey} → ${rewritten}`,
    ),
  };
}

export function canonicalSubjectKey(
  state: ConversionState,
  annotationId: string,
): { state: Partial<ConversionState>; diagnostic?: MigrationDiagnostic } {
  if (state.identityAssigned) {
    return { state: {} };
  }

  const key = state.workingKey.trim();
  const { prefix, rest } = parseKeyPrefix(key);

  switch (state.canonicalLayer) {
    case "mentions": {
      if (!key.startsWith("mention:")) {
        throw new Error(
          `canonical_subject_key: mentions layer requires mention: prefix after conversion, got '${key}'`,
        );
      }
      return {
        state: {
          identityKey: key,
          conceptLeaf: rest,
          conceptAncestry: [rest],
          identityAssigned: true,
        },
        diagnostic: makeDiagnostic(
          annotationId,
          "canonical_subject_key",
          `mention key → identity ${key}, conceptLeaf ${rest}`,
        ),
      };
    }
    case "raw-hits": {
      if (!key.startsWith("raw_hit:")) {
        throw new Error(
          `canonical_subject_key: raw-hits layer requires raw_hit: prefix, got '${key}'`,
        );
      }
      return {
        state: {
          identityKey: key,
          conceptLeaf: rest,
          conceptAncestry: [rest],
          identityAssigned: true,
        },
        diagnostic: makeDiagnostic(
          annotationId,
          "canonical_subject_key",
          `raw_hit key → identity ${key}, conceptLeaf ${rest}`,
        ),
      };
    }
    case "data-items": {
      if (!key.startsWith("data_item:")) {
        throw new Error(
          `canonical_subject_key: data-items layer requires data_item: prefix, got '${key}'`,
        );
      }
      return {
        state: {
          identityKey: key,
          conceptLeaf: rest,
          conceptAncestry: [rest],
          identityAssigned: true,
        },
        diagnostic: makeDiagnostic(
          annotationId,
          "canonical_subject_key",
          `data_item key → identity ${key}, conceptLeaf ${rest}`,
        ),
      };
    }
    case "components": {
      return { state: {} };
    }
    case "data-flows": {
      return {
        state: {
          identityKey: key,
          conceptLeaf: rest || "data_transfer",
          conceptAncestry: [rest || "data_transfer"],
          identityAssigned: true,
        },
        diagnostic: makeDiagnostic(
          annotationId,
          "canonical_subject_key",
          `flow key preserved as migration identity ${key}`,
        ),
      };
    }
    default:
      throw new Error(`canonical_subject_key: unsupported layer '${state.canonicalLayer}'`);
  }
}

function appendLegacySubjectKeyToken(
  state: ConversionState,
  legacyKey: string,
): ObservedTokenCandidate[] {
  const trimmed = legacyKey.trim();
  if (!trimmed) {
    return state.observedTokenCandidates;
  }
  const alreadyParked = state.observedTokenCandidates.some(
    (token) => token.provenance === "legacy-subject-key" && token.value === trimmed,
  );
  if (alreadyParked) {
    return state.observedTokenCandidates;
  }
  return [...state.observedTokenCandidates, tokenCandidate(trimmed, 0, "legacy-subject-key")];
}

export function componentStructuredIdentity(
  state: ConversionState,
  input: LegacyGoldRecord,
  options: LoadLegacyGoldOptions = {},
): { state: Partial<ConversionState>; diagnostics: MigrationDiagnostic[] } {
  if (state.canonicalLayer !== "components" || input.layer !== "components") {
    return { state: {}, diagnostics: [] };
  }

  if (input.canonical) {
    const block = input.canonical;
    const optionalAssertion: OptionalAssertion | undefined = block.vendor
      ? { vendor: block.vendor }
      : undefined;
    return {
      state: {
        identityKey: block.identity_key,
        componentType: block.component_type,
        componentSubtype: block.component_subtype,
        conceptLeaf: block.component_subtype,
        conceptAncestry: [block.component_subtype],
        entityId: block.entity_id,
        optionalAssertion,
        identityAssigned: true,
        observedTokenCandidates: appendLegacySubjectKeyToken(state, input.subject.key),
      },
      diagnostics: [
        makeDiagnostic(
          input.id,
          "component_canonical_block",
          `canonical block → identity ${block.identity_key}, entityId ${block.entity_id}`,
        ),
      ],
    };
  }

  const legacyKey = input.subject.key.trim();
  const { prefix, rest } = parseKeyPrefix(legacyKey);
  const componentType = prefix;
  const componentSubtype = resolveComponentSubtype(
    componentType,
    input.expected.labels,
    rest,
  );
  const identityKey = classificationIdentityKey(componentType, componentSubtype);

  let optionalAssertion: OptionalAssertion | undefined;
  const diagnostics: MigrationDiagnostic[] = [
    makeDiagnostic(
      input.id,
      "component_structured_identity",
      `legacy key ${legacyKey} → classification identity ${identityKey}, subtype ${componentSubtype}`,
    ),
  ];

  if (componentType === "third_party") {
    optionalAssertion = { vendor: rest };
    diagnostics.push(
      makeDiagnostic(
        input.id,
        "component_structured_identity",
        `third_party vendor asserted from key suffix '${rest}'`,
      ),
    );
  }

  let entityId: string | undefined;
  if (options.repoKey) {
    entityId = buildRepoLocalEntityId(options.repoKey, input.id);
    diagnostics.push(
      makeDiagnostic(
        input.id,
        "component_structured_identity",
        `entityId ${entityId} (bookkeeping only)`,
      ),
    );
  }

  return {
    state: {
      identityKey,
      componentType,
      componentSubtype,
      conceptLeaf: componentSubtype,
      conceptAncestry: [componentSubtype],
      optionalAssertion,
      entityId,
      identityAssigned: true,
      observedTokenCandidates: appendLegacySubjectKeyToken(state, legacyKey),
    },
    diagnostics,
  };
}

export function dataItemCandidateBlock(
  state: ConversionState,
  input: LegacyGoldRecord,
): { state: Partial<ConversionState>; diagnostics: MigrationDiagnostic[] } {
  if (state.canonicalLayer !== "data-items" || input.layer !== "data_items") {
    return { state: {}, diagnostics: [] };
  }

  const candidate = input.candidate;
  if (!candidate || candidate.kind !== "data_item") {
    return { state: {}, diagnostics: [] };
  }

  const diagnostics: MigrationDiagnostic[] = [
    makeDiagnostic(
      input.id,
      "data_item_candidate_block",
      `non-scoring candidate proposes ${candidate.proposed_identity_key} → ${candidate.proposed_concept_leaf}`,
    ),
  ];

  const parked: ObservedTokenCandidate[] = [
    tokenCandidate(candidate.proposed_identity_key, 0, "data-item-candidate-identity"),
    tokenCandidate(candidate.proposed_concept_leaf, 0, "data-item-candidate-leaf"),
  ];
  for (const ancestor of candidate.proposed_ancestry) {
    parked.push(tokenCandidate(ancestor, 0, "data-item-candidate-ancestry"));
  }
  if (candidate.candidate_notes) {
    parked.push(tokenCandidate(candidate.candidate_notes, 0, "data-item-candidate-notes"));
  }

  return {
    state: {
      observedTokenCandidates: [...state.observedTokenCandidates, ...parked],
    },
    diagnostics,
  };
}

export function flowCandidateIdentity(
  state: ConversionState,
  input: LegacyGoldRecord,
): { state: Partial<ConversionState>; diagnostics: MigrationDiagnostic[] } {
  if (state.canonicalLayer !== "data-flows" || input.layer !== "data_flows") {
    return { state: {}, diagnostics: [] };
  }

  const candidate = input.candidate;
  if (!candidate || candidate.kind !== "flow") {
    return { state: {}, diagnostics: [] };
  }

  const diagnostics: MigrationDiagnostic[] = [];
  const patch: Partial<ConversionState> = {};

  const endpoints = candidateEndpointsToAsserted(candidate);
  if (endpoints) {
    patch.flowEndpoints = endpoints;
    diagnostics.push(
      makeDiagnostic(
        input.id,
        "flow_candidate_block",
        `flow candidate endpoints → ${candidate.candidate_identity_key ?? "typed endpoints"}`,
      ),
    );
  }

  const flowAssertion = flowCandidateToFlowAssertion(candidate);
  if (flowAssertion) {
    patch.flowAssertion = flowAssertion;
  }

  if (candidate.proposed_flow_type) {
    patch.conceptLeaf = candidate.proposed_flow_type;
    patch.conceptAncestry = [candidate.proposed_flow_type];
    diagnostics.push(
      makeDiagnostic(
        input.id,
        "flow_candidate_block",
        `proposed flow_type ${candidate.proposed_flow_type} parked on classification (non-scoring)`,
      ),
    );
  }

  if (candidate.candidate_identity_key) {
    patch.identityKey = candidate.candidate_identity_key;
    patch.identityAssigned = true;
  }

  return { state: patch, diagnostics };
}

export function ruleIdToConceptLeafConversion(
  state: ConversionState,
  input: LegacyGoldRecord,
): { state: Partial<ConversionState>; diagnostic?: MigrationDiagnostic } {
  if (state.canonicalLayer !== "mentions" && state.canonicalLayer !== "raw-hits") {
    return { state: {} };
  }

  const { rest } = parseKeyPrefix(state.identityKey);
  const entry = tryRuleIdToConceptEntry(rest);
  if (!entry) {
    return { state: {} };
  }

  return {
    state: {
      conceptLeaf: entry.conceptLeaf,
      conceptAncestry: entry.conceptAncestry,
    },
    diagnostic: makeDiagnostic(
      input.id,
      "rule_id_to_concept_leaf",
      `rule_id ${rest} → conceptLeaf ${entry.conceptLeaf}`,
    ),
  };
}

export function legacySubjectName(
  state: ConversionState,
  input: LegacyGoldRecord,
): { state: Partial<ConversionState>; diagnostic?: MigrationDiagnostic } {
  const name = input.subject.name?.trim();
  if (!name) {
    return { state: {} };
  }

  let provenance = "legacy-subject-name";
  if (state.canonicalLayer === "components" && state.componentType === "third_party") {
    provenance = "legacy-vendor-candidate";
  }

  const patch: Partial<ConversionState> = {
    observedTokenCandidates: [
      ...state.observedTokenCandidates,
      tokenCandidate(name, 0, provenance),
    ],
  };

  if (state.canonicalLayer === "data-flows") {
    patch.displayText = name;
  }

  return {
    state: patch,
    diagnostic: makeDiagnostic(
      input.id,
      "legacy_subject_name",
      `subject.name '${name}' → observed token (layer ${state.canonicalLayer})`,
    ),
  };
}

export function expectedLabelsProvenance(
  state: ConversionState,
  input: LegacyGoldRecord,
): { state: Partial<ConversionState>; diagnostic?: MigrationDiagnostic } {
  if (input.expected.labels.length === 0) {
    return { state: {} };
  }

  const labelCandidates = input.expected.labels.map((label) =>
    tokenCandidate(label, 0, "legacy-expected-label"),
  );

  return {
    state: {
      observedTokenCandidates: [...state.observedTokenCandidates, ...labelCandidates],
    },
    diagnostic: makeDiagnostic(
      input.id,
      "expected_labels_provenance",
      `parked ${input.expected.labels.length} expected.labels as observed-token provenance`,
    ),
  };
}

export function expectedStatusDisposition(
  state: ConversionState,
  input: LegacyGoldRecord,
): { state: Pick<ConversionState, "disposition">; diagnostic: MigrationDiagnostic } {
  const disposition = resolveDisposition(input, state.canonicalLayer, state.conceptLeaf);
  return {
    state: { disposition },
    diagnostic: makeDiagnostic(
      input.id,
      "expected_status_disposition",
      `expected.status=${input.expected.status}, review_state=${input.provenance.review_state} → disposition ${disposition}`,
    ),
  };
}

function resolveDisposition(
  input: LegacyGoldRecord,
  canonicalLayer: CanonicalLayer,
  conceptLeaf: string,
): CanonicalDisposition {
  const { expected, provenance } = input;

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

function buildRejectedGoldRecord(
  state: ConversionState,
  input: LegacyGoldRecord,
  adapterMapVersion?: string,
): CanonicalGoldExpectation {
  const envelope = stampEnvelope(adapterMapVersion);
  return {
    ...envelope,
    identity: { layer: state.canonicalLayer, identityKey: state.identityKey },
    classification: {
      conceptLeaf: state.conceptLeaf,
      conceptAncestry: state.conceptAncestry,
      componentType: state.componentType,
      componentSubtype: state.componentSubtype,
    },
    optionalAssertion: state.optionalAssertion,
    evidenceLocations: [input.evidence],
    observedTokenCandidates:
      state.observedTokenCandidates.length > 0 ? state.observedTokenCandidates : undefined,
    display: state.displayText !== undefined ? { displayText: state.displayText } : undefined,
    disposition: "rejected",
  };
}

export function buildCanonicalRecord(
  state: ConversionState,
  input: LegacyGoldRecord,
  adapterMapVersion?: string,
): CanonicalGoldExpectation {
  const base = {
    layer: state.canonicalLayer,
    identityKey: state.identityKey,
    conceptLeaf: state.conceptLeaf,
    conceptAncestry: state.conceptAncestry,
    componentType: state.componentType,
    componentSubtype: state.componentSubtype,
    optionalAssertion: state.optionalAssertion,
    evidenceLocations: [input.evidence],
    observedTokenCandidates:
      state.observedTokenCandidates.length > 0 ? state.observedTokenCandidates : undefined,
    displayText: state.displayText,
    adapterMapVersion,
    entityId: state.entityId,
    flowEndpoints: state.flowEndpoints,
    flowAssertion: state.flowAssertion,
  };

  switch (state.disposition) {
    case "accepted":
      return buildAcceptedGoldExpectation(base);
    case "needs_adjudication":
      return buildNeedsAdjudicationRecord(base);
    case "migration_incomplete":
      return buildMigrationIncompleteRecord(base);
    case "rejected":
      return buildRejectedGoldRecord(state, input, adapterMapVersion);
    default:
      throw new Error(`Unsupported disposition '${state.disposition as string}'`);
  }
}

export function initialConversionState(input: LegacyGoldRecord): ConversionState {
  return {
    canonicalLayer: "mentions",
    workingKey: input.subject.key.trim(),
    identityKey: "",
    conceptLeaf: "",
    conceptAncestry: [],
    observedTokenCandidates: [],
    disposition: "needs_adjudication",
    identityAssigned: false,
  };
}

export const CONVERSION_KINDS: readonly ConversionKind[] = [
  "corpus_layer_to_canonical",
  "pii_signal_prefix_rewrite",
  "canonical_subject_key",
  "component_structured_identity",
  "component_canonical_block",
  "rule_id_to_concept_leaf",
  "legacy_subject_name",
  "expected_labels_provenance",
  "expected_status_disposition",
  "flow_candidate_block",
  "data_item_candidate_block",
];
