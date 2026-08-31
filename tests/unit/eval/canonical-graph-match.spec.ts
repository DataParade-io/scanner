import {
  buildFlowFinding,
  buildFlowGoldExpectation,
  graphStrictCorrectness,
  oneFindingCannotSatisfyBoth,
  sampleEvidence,
  withId,
} from "../../eval/canonical";

const evidenceA = [sampleEvidence("src/app.ts", 10, 10)];
const evidenceB = [sampleEvidence("src/app.ts", 20, 20)];

describe("flow graph cardinality", () => {
  const flowEndpointsStripe = {
    source: { componentType: "asset", endpointKey: "api" },
    target: { componentType: "third_party", endpointKey: "stripe" },
  };
  const flowEndpointsOpenAi = {
    source: { componentType: "asset", endpointKey: "api" },
    target: { componentType: "third_party", endpointKey: "openai" },
  };

  it("preserves distinct flow edges sharing a source endpoint", () => {
    const expectations = [
      withId(
        buildFlowGoldExpectation({
          layer: "data-flows",
          identityKey: "flow:asset:api->third_party:stripe",
          conceptLeaf: "api_call",
          evidenceLocations: evidenceA,
          flowEndpoints: flowEndpointsStripe,
        }),
        "flow-stripe",
      ),
      withId(
        buildFlowGoldExpectation({
          layer: "data-flows",
          identityKey: "flow:asset:api->third_party:openai",
          conceptLeaf: "api_call",
          evidenceLocations: evidenceB,
          flowEndpoints: flowEndpointsOpenAi,
        }),
        "flow-openai",
      ),
    ];

    const finding = withId(
      buildFlowFinding({
        layer: "data-flows",
        identityKey: "flow:asset:api->third_party:stripe",
        conceptLeaf: "api_call",
        evidenceLocations: evidenceA,
        flowEndpoints: flowEndpointsStripe,
      }),
      "find-stripe",
    );

    expect(oneFindingCannotSatisfyBoth(expectations, finding)).toBe(true);
    expect(graphStrictCorrectness(expectations[0], finding)).toBe(true);
    expect(graphStrictCorrectness(expectations[1], finding)).toBe(false);
  });
});
