import {
  parseTypedFlowKey,
  parseTypedFlowKeyOrThrow,
  ProseFlowKeyError,
  flowEndpointsMatch,
  typedComponentEndpointsMatch,
} from "../../eval/canonical";

describe("parseTypedFlowKey", () => {
  it("parses typed component endpoint keys", () => {
    const result = parseTypedFlowKey("flow:asset:api->third_party:stripe");
    expect(result.parsed).toBe(true);
    if (!result.parsed) {
      throw new Error("expected parsed result");
    }
    expect(result.endpoints.source).toEqual({
      componentType: "asset",
      endpointKey: "api",
    });
    expect(result.endpoints.target).toEqual({
      componentType: "third_party",
      endpointKey: "stripe",
    });
  });

  it("rejects prose flow keys without typed endpoints", () => {
    const prose = parseTypedFlowKey("flow:password->wp_check_password");
    expect(prose.parsed).toBe(false);
    if (prose.parsed) {
      throw new Error("expected unparsed prose key");
    }
    expect(prose.reason).toMatch(/type:name/i);
  });

  it("rejects pseudo-endpoint prose keys", () => {
    const result = parseTypedFlowKey("flow:authorization-header->basic-authorization");
    expect(result.parsed).toBe(false);
  });

  it("throws ProseFlowKeyError for prose keys via parseTypedFlowKeyOrThrow", () => {
    expect(() => parseTypedFlowKeyOrThrow("flow:session->session-authenticator")).toThrow(
      ProseFlowKeyError,
    );
  });
});

describe("flow endpoint matching", () => {
  it("matches typed endpoints and ignores display-only differences", () => {
    const left = {
      source: { componentType: "asset", endpointKey: "api" },
      target: { componentType: "third_party", endpointKey: "stripe" },
    };
    const right = {
      source: { componentType: "asset", endpointKey: "api" },
      target: { componentType: "third_party", endpointKey: "stripe" },
    };
    expect(flowEndpointsMatch(left, right)).toBe(true);
  });

  it("requires asserted vendor on typed third-party endpoints when present", () => {
    const expected = {
      componentType: "third_party",
      endpointKey: "stripe",
      optionalAssertion: { vendor: "stripe" },
    };
    const actual = {
      componentType: "third_party",
      endpointKey: "stripe",
      optionalAssertion: { vendor: "checkr" },
    };
    expect(typedComponentEndpointsMatch(expected, actual)).toBe(false);
  });
});
