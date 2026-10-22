import {
  defaultServiceNameFromLiteralPublicUrl,
  hostMatchesOrganizationDomains,
  inferThirdPartyFromLiteralHttpUrl,
  normalizeOrganizationDomains,
  shouldIgnoreExternalHttpUrl,
  urlHostMatchKeys,
} from "../../../src/classifier/external-url-third-party";
import type { RawFinding } from "../../../src/core/types/detection";

function makeExternalFinding(
  props: Record<string, unknown>,
  name = "x",
): RawFinding {
  return {
    pattern: "external_api_call",
    name,
    confidence: 0.9,
    location: {
      filePath: "svc.js",
      startLine: 1,
      endLine: 1,
    },
    properties: props,
  };
}

describe("classifier/external-url-third-party", () => {
  it("shouldIgnoreExternalHttpUrl ignores placeholders and accepts public hosts", () => {
    expect(shouldIgnoreExternalHttpUrl(undefined)).toBe(true);
    expect(shouldIgnoreExternalHttpUrl("https://...")).toBe(true);
    expect(shouldIgnoreExternalHttpUrl("http://localhost:3000/")).toBe(true);
    expect(shouldIgnoreExternalHttpUrl("https://api.acme-vendor.com/v1")).toBe(
      false,
    );
  });

  it("shouldIgnoreExternalHttpUrl ignores null hostname without throwing", () => {
    const url = new URL("https://api.acme-vendor.com/v1");
    Object.defineProperty(url, "hostname", { get: () => null });
    const parseSpy = jest.spyOn(globalThis, "URL").mockImplementation(
      () => url as unknown as URL,
    );
    try {
      expect(shouldIgnoreExternalHttpUrl("https://api.acme-vendor.com/v1")).toBe(
        true,
      );
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("defaultServiceNameFromLiteralPublicUrl derives registrable host without YAML", () => {
    expect(
      defaultServiceNameFromLiteralPublicUrl(
        "https://api.weirdvendor.vendor-corp.net/v1",
      ),
    ).toBe("vendor-corp.net");
    expect(
      defaultServiceNameFromLiteralPublicUrl(
        "https://clipdrop-api.co/remove-background/v1",
      ),
    ).toBe("clipdrop-api.co");
  });

  it("defaultServiceNameFromLiteralPublicUrl returns undefined for placeholder template URLs", () => {
    expect(
      defaultServiceNameFromLiteralPublicUrl("https://..."),
    ).toBeUndefined();
    expect(
      inferThirdPartyFromLiteralHttpUrl(
        makeExternalFinding({ url: "https://...", client: "fetch" }),
      ),
    ).toBeUndefined();
  });

  it("defaultServiceNameFromLiteralPublicUrl returns undefined for env or local URLs", () => {
    expect(
      defaultServiceNameFromLiteralPublicUrl(
        "https://x.com${process.env.BASE}",
      ),
    ).toBeUndefined();
    expect(
      defaultServiceNameFromLiteralPublicUrl("http://localhost:3000/"),
    ).toBeUndefined();
  });

  it("urlHostMatchKeys includes hostname and registrable domain", () => {
    const keys = urlHostMatchKeys(
      "https://api.thenextleg.io/v2/message/123",
    );
    expect(keys.has("api.thenextleg.io")).toBe(true);
    expect(keys.has("thenextleg.io")).toBe(true);
  });

  it("infers third_party from literal https url property (catalog subType)", () => {
    const out = inferThirdPartyFromLiteralHttpUrl(
      makeExternalFinding({
        url: "https://clipdrop-api.co/remove-background/v1",
        client: "fetch",
      }),
    );
    expect(out?.serviceName).toBe("clipdrop-api.co");
    expect(out?.subType).toBe("ai_provider");
  });

  it("infers ai_provider subType from catalog match on hostname (e.g. OpenAI)", () => {
    const out = inferThirdPartyFromLiteralHttpUrl(
      makeExternalFinding({
        url: "https://api.openai.com/v1/chat/completions",
        client: "fetch",
      }),
    );
    expect(out?.serviceName).toBe("openai.com");
    expect(out?.subType).toBe("ai_provider");
  });

  it("returns undefined when url references process.env", () => {
    expect(
      inferThirdPartyFromLiteralHttpUrl(
        makeExternalFinding({
          url: 'https://api.acme-vendor.com${process.env.FOO}',
        }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined for localhost", () => {
    expect(
      inferThirdPartyFromLiteralHttpUrl(
        makeExternalFinding({ url: "http://localhost:3021/v1" }),
      ),
    ).toBeUndefined();
  });

  it("infers saas_service for generic vendor host", () => {
    const out = inferThirdPartyFromLiteralHttpUrl(
      makeExternalFinding({
        url: "https://payments.example-saas.io/v1/charges",
      }),
    );
    expect(out?.serviceName).toBe("example-saas.io");
    expect(out?.subType).toBe("saas_service");
  });

  it("normalizeOrganizationDomains strips schemes and rejects bare TLDs", () => {
    expect(
      normalizeOrganizationDomains([
        "HTTPS://WWW.dataparade.io/path",
        "dataparade.io",
        "io",
        "",
      ]),
    ).toEqual(["dataparade.io"]);
  });

  it("hostMatchesOrganizationDomains matches subdomains with suffix boundaries", () => {
    const domains = ["dataparade.io"];
    expect(hostMatchesOrganizationDomains("api.dataparade.io", domains)).toBe(
      true,
    );
    expect(hostMatchesOrganizationDomains("dataparade.io", domains)).toBe(true);
    expect(hostMatchesOrganizationDomains("evil-dataparade.io", domains)).toBe(
      false,
    );
    expect(hostMatchesOrganizationDomains("notdataparade.io", domains)).toBe(
      false,
    );
  });

  it("treats organization domains like non-third-party URLs when configured", () => {
    const opts = { organizationDomains: ["dataparade.io"] };
    expect(
      shouldIgnoreExternalHttpUrl("https://app.dataparade.io/v1", opts),
    ).toBe(true);
    expect(
      inferThirdPartyFromLiteralHttpUrl(
        makeExternalFinding({ url: "https://app.dataparade.io/v1" }),
        opts,
      ),
    ).toBeUndefined();
    expect(
      shouldIgnoreExternalHttpUrl("https://api.stripe.com/v1/charges", opts),
    ).toBe(false);
    expect(
      inferThirdPartyFromLiteralHttpUrl(
        makeExternalFinding({ url: "https://api.stripe.com/v1/charges" }),
        opts,
      )?.serviceName,
    ).toBe("stripe.com");
  });

  it("empty organizationDomains list behaves like unset for public hosts", () => {
    const url = "https://api.weirdvendor.io/v1/foo";
    expect(shouldIgnoreExternalHttpUrl(url, { organizationDomains: [] })).toBe(
      false,
    );
    expect(
      inferThirdPartyFromLiteralHttpUrl(
        makeExternalFinding({ url }),
        { organizationDomains: [] },
      )?.serviceName,
    ).toBe("weirdvendor.io");
  });
});
