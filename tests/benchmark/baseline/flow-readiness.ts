import type { AnnotationRecord, FlowDispositionCandidate } from "../schema";
import type { BaselineReadinessPolicy } from "./readiness-policy";
import type { LayerGoldPopulation } from "./types";

export function resolveFlowDispositionCandidate(
  annotation: AnnotationRecord,
): FlowDispositionCandidate | null {
  return (
    annotation.flow_canonical?.disposition_candidate ??
    (annotation.candidate?.kind === "flow"
      ? annotation.candidate.disposition_candidate
      : null)
  );
}

export function isEligibleFlowAnnotation(
  annotation: AnnotationRecord,
  policy: BaselineReadinessPolicy,
): boolean {
  if (annotation.provenance.review_state !== "accepted") {
    return false;
  }
  const disposition = resolveFlowDispositionCandidate(annotation);
  if (!disposition) {
    return false;
  }
  return (policy.flowSubset.eligibleDispositionCandidates as readonly FlowDispositionCandidate[]).includes(
    disposition,
  );
}

export function isFlowLayerScoreable(
  flowStats: LayerGoldPopulation,
  policy: BaselineReadinessPolicy,
): boolean {
  const flowPolicy = policy.flowSubset;
  return (
    flowStats.acceptedCanonicalCount >= flowPolicy.minAcceptedCanonicalCount &&
    flowStats.packetDiversity.distinctPackets >= flowPolicy.minDistinctPackets &&
    flowStats.distinctConceptLeaves >= flowPolicy.minDistinctFlowTypes
  );
}
