import { stampEnvelope } from "./contract";
import type {
  CanonicalGoldExpectation,
  CanonicalLayer,
  CanonicalScannerFinding,
  EvidenceLocation,
  NeedsAdjudicationRecord,
  ObservedTokenCandidate,
  OptionalAssertion,
  AssertedFlowEndpoints,
  FlowAssertion,
} from "./types";

export interface BuildFindingInput {
  layer: CanonicalLayer;
  identityKey: string;
  conceptLeaf: string;
  conceptAncestry?: readonly string[];
  componentType?: string;
  componentSubtype?: string;
  optionalAssertion?: OptionalAssertion;
  evidenceLocations: EvidenceLocation[];
  derivationLocations?: EvidenceLocation[];
  observedTokenCandidates?: ObservedTokenCandidate[];
  displayText?: string;
  disposition?: CanonicalScannerFinding["disposition"];
  adapterMapVersion?: string;
  declaredCapabilitySupported?: CanonicalScannerFinding["declaredCapabilitySupported"];
  flowEndpoints?: AssertedFlowEndpoints;
  flowAssertion?: FlowAssertion;
}

export interface BuildGoldInput extends BuildFindingInput {
  entityId?: string;
  declaredCapabilitySupported?: CanonicalGoldExpectation["declaredCapabilitySupported"];
}

function baseFindingFields(input: BuildFindingInput): CanonicalScannerFinding {
  const envelope = stampEnvelope(input.adapterMapVersion);
  return {
    ...envelope,
    identity: { layer: input.layer, identityKey: input.identityKey },
    classification: {
      conceptLeaf: input.conceptLeaf,
      conceptAncestry: input.conceptAncestry ?? [input.conceptLeaf],
      componentType: input.componentType,
      componentSubtype: input.componentSubtype,
    },
    optionalAssertion: input.optionalAssertion,
    evidenceLocations: input.evidenceLocations,
    derivationLocations: input.derivationLocations,
    observedTokenCandidates: input.observedTokenCandidates,
    display: input.displayText !== undefined ? { displayText: input.displayText } : undefined,
    disposition: input.disposition ?? "accepted",
    declaredCapabilitySupported: input.declaredCapabilitySupported,
    flowEndpoints: input.flowEndpoints,
    flowAssertion: input.flowAssertion,
  };
}

function baseGoldFields(input: BuildGoldInput): CanonicalGoldExpectation {
  const envelope = stampEnvelope(input.adapterMapVersion);
  return {
    ...envelope,
    identity: { layer: input.layer, identityKey: input.identityKey },
    classification: {
      conceptLeaf: input.conceptLeaf,
      conceptAncestry: input.conceptAncestry ?? [input.conceptLeaf],
      componentType: input.componentType,
      componentSubtype: input.componentSubtype,
    },
    optionalAssertion: input.optionalAssertion,
    evidenceLocations: input.evidenceLocations,
    derivationLocations: input.derivationLocations,
    observedTokenCandidates: input.observedTokenCandidates,
    display: input.displayText !== undefined ? { displayText: input.displayText } : undefined,
    disposition: input.disposition ?? "accepted",
    entityId: input.entityId,
    declaredCapabilitySupported: input.declaredCapabilitySupported,
    flowEndpoints: input.flowEndpoints,
    flowAssertion: input.flowAssertion,
  };
}

export function buildScannerFinding(input: BuildFindingInput): CanonicalScannerFinding {
  return baseFindingFields(input);
}

export function buildNeedsAdjudicationRecord(input: BuildGoldInput): NeedsAdjudicationRecord {
  return {
    ...baseGoldFields({ ...input, disposition: "needs_adjudication" }),
    disposition: "needs_adjudication",
  };
}
