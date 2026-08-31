import { conceptCorrectness } from "../match";
import { contractVersionsMatch } from "../contract";
import { evidenceLocationsOverlap, sameEntityIdentity } from "../identity";
import type { CanonicalGoldExpectation, CanonicalScannerFinding } from "../types";
import { flowDataCategoriesMatch, flowEndpointsMatch } from "./endpoints";
import type { GraphMatchAttribution, GraphMatchStage } from "./types";

function classificationsMatchForEndpoints(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  const exp = expectation.classification;
  const act = finding.classification;
  if (exp.componentType !== undefined && exp.componentType !== act.componentType) {
    return false;
  }
  if (
    exp.componentSubtype !== undefined &&
    exp.componentSubtype !== act.componentSubtype
  ) {
    return false;
  }
  return true;
}

function optionalVendorMatch(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean | "not_asserted" {
  const expectedVendor = expectation.optionalAssertion?.vendor;
  if (expectedVendor === undefined) {
    return "not_asserted";
  }
  return finding.optionalAssertion?.vendor === expectedVendor;
}

function dataCategoriesResolved(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean | "not_asserted" {
  const expected = expectation.flowAssertion?.dataCategories;
  if (!expected || expected.length === 0) {
    return "not_asserted";
  }
  const actual = finding.flowAssertion?.dataCategories ?? [];
  return flowDataCategoriesMatch(expected, actual);
}

function endpointsResolved(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): boolean {
  if (expectation.identity.layer === "data-flows") {
    const expEndpoints = expectation.flowEndpoints;
    const actEndpoints = finding.flowEndpoints;
    if (!expEndpoints || !actEndpoints) {
      return false;
    }
    return flowEndpointsMatch(expEndpoints, actEndpoints);
  }

  return classificationsMatchForEndpoints(expectation, finding);
}

export function attributeGraphMatch(
  expectation: CanonicalGoldExpectation,
  finding: CanonicalScannerFinding,
): GraphMatchAttribution {
  const failedStages: GraphMatchStage[] = [];

  const topologyDetected =
    contractVersionsMatch(expectation, finding) &&
    sameEntityIdentity(expectation.identity, finding.identity) &&
    evidenceLocationsOverlap(expectation.evidenceLocations, finding.evidenceLocations);

  if (!topologyDetected) {
    failedStages.push("topology_detection");
  }

  const endpointsOk = topologyDetected && endpointsResolved(expectation, finding);
  if (!endpointsOk) {
    failedStages.push("endpoint_resolution");
  }

  const { exactLeaf, ancestorCategory } = conceptCorrectness(expectation, finding);
  if (!exactLeaf) {
    failedStages.push("semantic_classification");
  }

  const vendorResolved = optionalVendorMatch(expectation, finding);
  if (vendorResolved === false) {
    failedStages.push("vendor_resolution");
  }

  const categoriesResolved = dataCategoriesResolved(expectation, finding);
  if (categoriesResolved === false) {
    failedStages.push("data_categories");
  }

  const strictCorrect =
    expectation.disposition === "accepted" &&
    topologyDetected &&
    endpointsOk &&
    exactLeaf &&
    vendorResolved !== false &&
    categoriesResolved !== false;

  return {
    topologyDetected,
    endpointsResolved: endpointsOk,
    semanticExactLeaf: exactLeaf,
    semanticAncestorCategory: ancestorCategory,
    vendorResolved,
    dataCategoriesResolved: categoriesResolved,
    strictCorrect,
    failedStages,
  };
}
