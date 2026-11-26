import {
  classifyRawFindings,
  dedupeComponents,
} from "../../../src/classifier/classify";
import {
  defaultServiceNameFromLiteralPublicUrl,
  isReservedPlaceholderHost,
  shouldIgnoreExternalHttpUrl,
} from "../../../src/classifier/external-url-third-party";
import { toDisplayName } from "../../../src/classifier/naming";
import {
  canonicalFrameworkId,
  frameworkDisplayName,
} from "../../../src/patterns/frontend-frameworks";
import type { RawFinding } from "../../../src/core/types/detection";

function external(
  filePath: string,
  properties: Record<string, unknown>,
  name = "call",
): RawFinding {
  return {
    pattern: "external_api_call",
    name,
    confidence: 0.9,
    location: { filePath, startLine: 1, endLine: 1 },
    properties,
  };
}

function thirdPartyNames(findings: RawFinding[]): string[] {
  return classifyRawFindings(findings)
    .filter((c) => c.type === "third_party")
    .map((c) => c.name)
    .sort();
}

describe("placeholder hosts are not third parties", () => {
  it.each([
    "example.com",
    "www.example.com",
    "api.example.org",
    "a.b.example.net",
    "service.test",
    "foo.example",
    "bar.invalid",
    "app.localhost",
    "EXAMPLE.COM",
  ])("treats %s as a placeholder", (host) => {
    expect(isReservedPlaceholderHost(host)).toBe(true);
    expect(shouldIgnoreExternalHttpUrl(`https://${host}/x`)).toBe(true);
    expect(
      defaultServiceNameFromLiteralPublicUrl(`https://${host}/x`),
    ).toBeUndefined();
  });

  it.each([
    "notexample.com",
    "example.com.evil.io",
    "myexample.org",
    "test.io",
  ])("keeps %s as a real host", (host) => {
    expect(isReservedPlaceholderHost(host)).toBe(false);
    expect(shouldIgnoreExternalHttpUrl(`https://${host}/x`)).toBe(false);
  });

  it("classifier emits no third party for example.com URLs", () => {
    const names = thirdPartyNames([
      external("src/a.ts", { url: "https://example.com/hook" }),
      external("src/b.ts", { url: "https://api.example.org/v1" }),
    ]);
    expect(names).toEqual([]);
  });
});

describe("same-vendor domains collapse to one third party", () => {
  it("maps notion.com and notion.so to a single Notion vendor", () => {
    const comps = dedupeComponents(
      classifyRawFindings([
        external("src/a.ts", { url: "https://api.notion.com/v1/pages" }),
        external("src/b.ts", { url: "https://www.notion.so/page" }),
      ]),
    ).filter((c) => c.type === "third_party");
    expect(comps.map((c) => c.name)).toEqual(["Notion"]);
    expect(comps[0]?.properties.serviceName).toBe("notion");
  });
});

describe("display names are human readable", () => {
  it("formats snake_case service ids", () => {
    expect(toDisplayName("google_identity", "google_identity")).toBe(
      "Google Identity",
    );
    expect(toDisplayName("", "my_cool_service")).toBe("My Cool Service");
    expect(toDisplayName("stripe", "stripe")).toBe("Stripe");
    expect(toDisplayName("notion.so", "notion.so")).toBe("Notion.so");
  });

  it("names the google_identity third party 'Google Identity'", () => {
    expect(
      thirdPartyNames([
        external("src/a.rb", { serviceName: "google_identity" }),
      ]),
    ).toEqual(["Google Identity"]);
  });
});

describe("framework labels", () => {
  it("resolves detector spellings of Next.js to one id and label", () => {
    for (const spelling of [
      "next_or_react_route",
      "nextjs",
      "next",
      "Next.js",
    ]) {
      expect(canonicalFrameworkId(spelling)).toBe("nextjs");
      expect(frameworkDisplayName(spelling)).toBe("Next.js");
    }
  });

  it("formats other frameworks", () => {
    expect(frameworkDisplayName("express")).toBe("Express");
    expect(frameworkDisplayName("some_new_fw")).toBe("Some New Fw");
  });
});
