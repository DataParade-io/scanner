import {
  attributeGraphMatch,
  buildAcceptedGoldExpectation,
  buildFlowFinding,
  buildFlowGoldExpectation,
  buildScannerFinding,
  graphStrictCorrectness,
  sampleEvidence,
  withId,
} from "../../eval/canonical";

const evidence = [sampleEvidence("src/app.ts", 5, 5)];

describe("graph match attribution", () => {
  it("does not treat ancestor-only semantic match as strictCorrect", () => {
    const expectation = withId(
      buildAcceptedGoldExpectation({
        layer: "mentions",
        identityKey: "mention:driver-licence",
        conceptLeaf: "driver_licence",
        conceptAncestry: ["national_identifier", "driver_licence"],
        evidenceLocations: evidence,
      }),
    );
    const finding = withId(
      buildScannerFinding({
        layer: "mentions",
        identityKey: "mention:driver-licence",
        conceptLeaf: "national_identifier",
        conceptAncestry: ["national_identifier"],
        evidenceLocations: evidence,
      }),
    );
    const attribution = attributeGraphMatch(expectation, finding);
    expect(attribution.semanticAncestorCategory).toBe(true);
    expect(attribution.semanticExactLeaf).toBe(false);
    expect(attribution.strictCorrect).toBe(false);
    expect(attribution.failedStages).toContain("semantic_classification");
  });

  it("attributes partial failure when endpoints mismatch but leaf matches", () => {
    const flowEndpoints = {
      source: { componentType: "asset", endpointKey: "api" },
      target: { componentType: "third_party", endpointKey: "stripe" },
    };
    const expectation = withId(
      buildFlowGoldExpectation({
        layer: "data-flows",
        identityKey: "flow:asset:api->third_party:stripe",
        conceptLeaf: "api_call",
        evidenceLocations: evidence,
        flowEndpoints,
      }),
    );
    const finding = withId(
      buildFlowFinding({
        layer: "data-flows",
        identityKey: "flow:asset:api->third_party:stripe",
        conceptLeaf: "api_call",
        evidenceLocations: evidence,
        flowEndpoints: {
          source: { componentType: "asset", endpointKey: "api" },
          target: { componentType: "third_party", endpointKey: "openai" },
        },
      }),
    );
    const attribution = attributeGraphMatch(expectation, finding);
    expect(attribution.topologyDetected).toBe(true);
    expect(attribution.endpointsResolved).toBe(false);
    expect(attribution.semanticExactLeaf).toBe(true);
    expect(attribution.strictCorrect).toBe(false);
    expect(graphStrictCorrectness(expectation, finding)).toBe(false);
  });

  it("fails strictCorrect when vendor is asserted but mismatched", () => {
    const expectation = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::stripe",
        conceptLeaf: "payment_processor",
        componentType: "third_party",
        componentSubtype: "saas_service",
        optionalAssertion: { vendor: "stripe" },
        evidenceLocations: evidence,
      }),
    );
    const finding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::stripe",
        conceptLeaf: "payment_processor",
        componentType: "third_party",
        componentSubtype: "saas_service",
        optionalAssertion: { vendor: "checkr" },
        evidenceLocations: evidence,
      }),
    );
    const attribution = attributeGraphMatch(expectation, finding);
    expect(attribution.vendorResolved).toBe(false);
    expect(attribution.strictCorrect).toBe(false);
  });

  it("does not credit strictCorrect for prose flow records without flowEndpoints", () => {
    const expectation = withId(
      buildAcceptedGoldExpectation({
        layer: "data-flows",
        identityKey: "flow:password->wp_check_password",
        conceptLeaf: "data_transfer",
        evidenceLocations: evidence,
      }),
    );
    const finding = withId(
      buildScannerFinding({
        layer: "data-flows",
        identityKey: "flow:password->wp_check_password",
        conceptLeaf: "data_transfer",
        evidenceLocations: evidence,
      }),
    );
    const attribution = attributeGraphMatch(expectation, finding);
    expect(expectation.flowEndpoints).toBeUndefined();
    expect(attribution.endpointsResolved).toBe(false);
    expect(attribution.strictCorrect).toBe(false);
  });
});
