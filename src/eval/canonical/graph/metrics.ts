import type { CanonicalGoldExpectation, CanonicalScannerFinding } from "../types";
import { isAcceptedEvaluablePositive } from "../types";
import { attributeGraphMatch } from "./attribution";
import type { GraphMatchStage } from "./types";

export interface GraphVendorResolutionMetrics {
  denominator: number;
  matched: number;
}

export interface GraphStageMetrics {
  stage: GraphMatchStage;
  denominator: number;
  passed: number;
}

function assertsVendor(record: CanonicalGoldExpectation): boolean {
  return record.optionalAssertion?.vendor !== undefined;
}

export function computeGraphVendorResolution(
  expectations: Array<CanonicalGoldExpectation & { id: string }>,
  findings: Array<CanonicalScannerFinding & { id: string }>,
): GraphVendorResolutionMetrics {
  const vendorAsserting = expectations.filter(
    (record) => isAcceptedEvaluablePositive(record) && assertsVendor(record),
  );
  let matched = 0;
  for (const expectation of vendorAsserting) {
    if (
      findings.some((finding) => attributeGraphMatch(expectation, finding).strictCorrect)
    ) {
      matched += 1;
    }
  }
  return { denominator: vendorAsserting.length, matched };
}

function stagePassed(
  stage: GraphMatchStage,
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  const attribution = attributeGraphMatch(expectation, finding);
  switch (stage) {
    case "topology_detection":
      return attribution.topologyDetected;
    case "endpoint_resolution":
      return attribution.endpointsResolved;
    case "semantic_classification":
      return attribution.semanticExactLeaf;
    case "vendor_resolution":
      return attribution.vendorResolved !== false;
    case "data_categories":
      return attribution.dataCategoriesResolved !== false;
    default:
      return false;
  }
}

export function computeGraphStageMetrics(
  expectations: Array<CanonicalGoldExpectation & { id: string }>,
  findings: Array<CanonicalScannerFinding & { id: string }>,
): GraphStageMetrics[] {
  const positives = expectations.filter(isAcceptedEvaluablePositive);
  const denominator = positives.length;
  const stages: GraphMatchStage[] = [
    "topology_detection",
    "endpoint_resolution",
    "semantic_classification",
    "vendor_resolution",
    "data_categories",
  ];

  return stages.map((stage) => {
    let passed = 0;
    for (const expectation of positives) {
      if (findings.some((finding) => stagePassed(stage, expectation, finding))) {
        passed += 1;
      }
    }
    return { stage, denominator, passed };
  });
}
