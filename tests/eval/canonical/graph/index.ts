export type {
  AssertedFlowEndpoints,
  ComponentAnnotationRow,
  ComputabilityReason,
  ConsolidatedComponentEntity,
  ConsolidationResult,
  FlowAssertion,
  GraphLayerScope,
  GraphMatchAttribution,
  GraphMatchStage,
  GraphPrecisionItem,
  GraphPrecisionReport,
  ParseTypedFlowKeyFailure,
  ParseTypedFlowKeyResult,
  ParseTypedFlowKeySuccess,
  TypedComponentEndpoint,
} from "./types";

export { ProseFlowKeyError } from "./types";

export {
  flowDataCategoriesMatch,
  flowEndpointsMatch,
  parseComponentEndpointKey,
  parseTypedFlowKey,
  parseTypedFlowKeyOrThrow,
  typedComponentEndpointsMatch,
} from "./endpoints";

export { attributeGraphMatch } from "./attribution";

export { graphStrictCorrectness } from "./match";

export {
  consolidateComponentRows,
  consolidatedEntityDisposition,
} from "./consolidate";

export { computeGraphPrecision } from "./precision";

export {
  computeGraphStageMetrics,
  computeGraphVendorResolution,
} from "./metrics";
export type { GraphStageMetrics, GraphVendorResolutionMetrics } from "./metrics";
