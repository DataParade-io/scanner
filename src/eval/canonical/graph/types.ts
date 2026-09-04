import type { OptionalAssertion } from "../types";

/** Typed component endpoint from already-typed `type:name` keys only. */
export interface TypedComponentEndpoint {
  componentType: string;
  endpointKey: string;
  componentSubtype?: string;
  optionalAssertion?: Pick<OptionalAssertion, "vendor" | "instance">;
}

export interface AssertedFlowEndpoints {
  source: TypedComponentEndpoint;
  target: TypedComponentEndpoint;
}

export interface FlowAssertion {
  dataCategories: readonly string[];
  supportingProvenance?: readonly string[];
}

export type GraphMatchStage =
  | "topology_detection"
  | "endpoint_resolution"
  | "semantic_classification"
  | "vendor_resolution"
  | "data_categories";

export interface GraphMatchAttribution {
  topologyDetected: boolean;
  endpointsResolved: boolean;
  semanticExactLeaf: boolean;
  semanticAncestorCategory: boolean;
  vendorResolved: boolean | "not_asserted";
  dataCategoriesResolved: boolean | "not_asserted";
  strictCorrect: boolean;
  failedStages: GraphMatchStage[];
}

export type ComputabilityReason =
  | "locationless_finding"
  | "finding_outside_scope"
  | "no_exhaustive_scope"
  | "processed_scope_zero_predictions";

export interface GraphPrecisionItem {
  findingId: string;
  inDenominator: boolean;
  matched: boolean;
  computabilityReason?: ComputabilityReason;
}

export interface GraphPrecisionReport {
  items: GraphPrecisionItem[];
  denominator: number;
  matches: number;
  precision: number | null;
  locationlessVisible: Array<{ findingId: string; reason: ComputabilityReason }>;
  computabilityReason?: ComputabilityReason;
}

export interface ParseTypedFlowKeySuccess {
  parsed: true;
  endpoints: AssertedFlowEndpoints;
}

export interface ParseTypedFlowKeyFailure {
  parsed: false;
  reason: string;
}

export type ParseTypedFlowKeyResult = ParseTypedFlowKeySuccess | ParseTypedFlowKeyFailure;

export class ProseFlowKeyError extends Error {
  constructor(key: string, reason: string) {
    super(`Prose or untyped flow key '${key}': ${reason}`);
    this.name = "ProseFlowKeyError";
  }
}

export interface ComponentAnnotationRow {
  id: string;
  record: import("../types").CanonicalGoldExpectation;
}

export interface ConsolidatedComponentEntity {
  consolidatedId: string;
  entityId?: string;
  identity: import("../types").CanonicalEntityIdentity;
  classification: import("../types").AssertedClassification;
  optionalAssertion?: OptionalAssertion;
  evidenceLocations: import("../types").EvidenceLocation[];
  derivationLocations?: import("../types").EvidenceLocation[];
  sourceRowIds: readonly string[];
  disposition: import("../types").CanonicalDisposition;
}

export interface ConsolidationResult {
  entities: ConsolidatedComponentEntity[];
  adjudication: Array<import("../types").CanonicalGoldExpectation & { id: string }>;
}

export interface GraphLayerScope {
  exhaustiveScopeFiles: readonly string[];
  reviewState: string;
}
