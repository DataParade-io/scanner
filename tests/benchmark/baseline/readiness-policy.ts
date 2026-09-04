import type { HeadlineLayer } from "../../eval/score";

/** Versioned baseline readiness floors and rate limits (KDATAP-b87baf). */
export const BASELINE_READINESS_POLICY_VERSION = "baseline-readiness-policy/1" as const;

export interface LayerPopulationFloor {
  minAcceptedCanonicalCount: number;
  minDistinctPackets: number;
}

/** Headline flow dispositions counted toward readiness and scorecard gates. */
export interface FlowSubsetPolicy {
  eligibleDispositionCandidates: readonly ["graph_edge", "intra_component_lineage"];
  minAcceptedCanonicalCount: number;
  minDistinctPackets: number;
  minDistinctFlowTypes: number;
}

export interface RuntimeRateLimits {
  /** Max share of ingested paths with missing_or_path_contract_mismatch per layer. */
  maxPathContractMismatchRate: number;
  /** Max share of headline metrics in unscorable_provenance per layer. */
  maxUnscorableMetricRate: number;
}

export interface BaselineReadinessPolicy {
  version: typeof BASELINE_READINESS_POLICY_VERSION;
  layerFloors: Record<Exclude<HeadlineLayer, "data-flows">, LayerPopulationFloor>;
  flowSubset: FlowSubsetPolicy;
  runtimeLimits: RuntimeRateLimits;
}

export const BASELINE_READINESS_POLICY: BaselineReadinessPolicy = {
  version: BASELINE_READINESS_POLICY_VERSION,
  layerFloors: {
    components: {
      minAcceptedCanonicalCount: 450,
      minDistinctPackets: 25,
    },
    mentions: {
      minAcceptedCanonicalCount: 50,
      minDistinctPackets: 15,
    },
    "data-items": {
      minAcceptedCanonicalCount: 100,
      minDistinctPackets: 12,
    },
  },
  flowSubset: {
    eligibleDispositionCandidates: ["graph_edge", "intra_component_lineage"],
    minAcceptedCanonicalCount: 1,
    minDistinctPackets: 1,
    minDistinctFlowTypes: 1,
  },
  runtimeLimits: {
    maxPathContractMismatchRate: 0.1,
    maxUnscorableMetricRate: 0.25,
  },
};
