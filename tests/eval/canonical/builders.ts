import { stampEnvelope } from "./contract";
import type {
  AcceptedCanonicalGoldExpectation,
  AssertedFlowEndpoints,
  CanonicalDisposition,
  CanonicalEntityIdentity,
  CanonicalGoldExpectation,
  CanonicalLayer,
  CanonicalScannerFinding,
  EvidenceLocation,
  FlowAssertion,
  MigrationIncompleteRecord,
  NeedsAdjudicationRecord,
  ObservedTokenCandidate,
  OptionalAssertion,
} from "./types";

let syntheticIdCounter = 0;

export function nextSyntheticId(prefix: string): string {
  syntheticIdCounter += 1;
  return `${prefix}-${syntheticIdCounter}`;
}

export function resetSyntheticIds(): void {
  syntheticIdCounter = 0;
}

export interface BuildGoldInput {
  id?: string;
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
  disposition?: CanonicalDisposition;
  entityId?: string;
  adapterMapVersion?: string;
  declaredCapabilitySupported?: CanonicalGoldExpectation["declaredCapabilitySupported"];
  flowEndpoints?: AssertedFlowEndpoints;
  flowAssertion?: FlowAssertion;
}

export interface BuildFindingInput {
  id?: string;
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
  disposition?: CanonicalDisposition;
  adapterMapVersion?: string;
  declaredCapabilitySupported?: CanonicalScannerFinding["declaredCapabilitySupported"];
  flowEndpoints?: AssertedFlowEndpoints;
  flowAssertion?: FlowAssertion;
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

export function buildAcceptedGoldExpectation(
  input: BuildGoldInput & { conceptLeaf: string },
): AcceptedCanonicalGoldExpectation {
  if (!input.conceptLeaf.trim()) {
    throw new Error("Accepted evaluable positive requires a reviewed canonical concept leaf");
  }
  if (input.disposition !== undefined && input.disposition !== "accepted") {
    throw new Error("buildAcceptedGoldExpectation requires disposition accepted");
  }
  return {
    ...baseGoldFields({ ...input, disposition: "accepted" }),
    disposition: "accepted",
  };
}

export function buildMigrationIncompleteRecord(
  input: Omit<BuildGoldInput, "disposition" | "conceptLeaf"> & { conceptLeaf?: string },
): MigrationIncompleteRecord {
  return {
    ...baseGoldFields({
      ...input,
      conceptLeaf: input.conceptLeaf ?? "",
      disposition: "migration_incomplete",
    }),
    disposition: "migration_incomplete",
  };
}

export function buildNeedsAdjudicationRecord(
  input: BuildGoldInput,
): NeedsAdjudicationRecord {
  return {
    ...baseGoldFields({ ...input, disposition: "needs_adjudication" }),
    disposition: "needs_adjudication",
  };
}

export function buildScannerFinding(
  input: BuildFindingInput,
): CanonicalScannerFinding {
  return baseFindingFields(input);
}

export interface BuildFlowGoldInput extends BuildGoldInput {
  layer: "data-flows";
  flowEndpoints: AssertedFlowEndpoints;
  flowAssertion?: FlowAssertion;
}

export interface BuildFlowFindingInput extends BuildFindingInput {
  layer: "data-flows";
  flowEndpoints: AssertedFlowEndpoints;
  flowAssertion?: FlowAssertion;
}

export function buildFlowGoldExpectation(
  input: BuildFlowGoldInput & { conceptLeaf: string },
): AcceptedCanonicalGoldExpectation {
  return buildAcceptedGoldExpectation({
    ...input,
    layer: "data-flows",
  });
}

export function buildFlowFinding(input: BuildFlowFindingInput): CanonicalScannerFinding {
  return buildScannerFinding({
    ...input,
    layer: "data-flows",
  });
}

export function withId<T extends object>(record: T, id?: string): T & { id: string } {
  return { ...record, id: id ?? nextSyntheticId("rec") };
}

export const sampleEvidence = (
  file = "src/db.ts",
  start = 10,
  end = 10,
): EvidenceLocation => ({
  file_path: file,
  start_line: start,
  end_line: end,
});

export function componentIdentity(repo: string, entity: string): CanonicalEntityIdentity {
  return { layer: "components", identityKey: `${repo}::${entity}` };
}
