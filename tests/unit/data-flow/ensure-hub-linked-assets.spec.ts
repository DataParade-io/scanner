import type { DetectedComponent } from "../../../src/core/types/component";
import { ensureHubToUnlinkedAssets } from "../../../src/data-flow/ensure-hub-linked-assets";

function comp(
  partial: Partial<DetectedComponent> &
    Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return {
    subType: partial.subType,
    confidence: 0.9,
    detectedFrom: [],
    sourceLocations: [],
    properties: partial.properties ?? {},
    ...partial,
  };
}

describe("ensure-hub-linked-assets", () => {
  it("links main app to orphan API asset in the same section", () => {
    const components: DetectedComponent[] = [
      comp({
        id: "main_1",
        name: "twenty-apps",
        type: "asset",
        subType: "service",
        properties: {
          isMainApplication: true,
          section_id: "packages/twenty-apps",
        },
      }),
      comp({
        id: "api_1",
        name: "twenty-apps API",
        type: "asset",
        subType: "api",
        properties: { section_id: "packages/twenty-apps" },
      }),
    ];

    const flows = ensureHubToUnlinkedAssets(components, []);
    expect(flows).toHaveLength(1);
    expect(flows[0].sourceComponentId).toBe("main_1");
    expect(flows[0].targetComponentId).toBe("api_1");
    expect(flows[0].enrichmentNotes).toBe("section_api_hub_link");
    expect(flows[0].confidence).toBe(0.75);
  });

  it("links main app to orphan auth_service assets with auth rule notes", () => {
    const components: DetectedComponent[] = [
      comp({
        id: "main",
        name: "root API",
        type: "asset",
        subType: "api",
        properties: { isMainApplication: true },
      }),
      comp({
        id: "jwt",
        name: "Jwt",
        type: "asset",
        subType: "auth_service",
      }),
      comp({
        id: "devise",
        name: "Devise",
        type: "asset",
        subType: "auth_service",
      }),
      comp({
        id: "bcrypt",
        name: "Bcrypt",
        type: "asset",
        subType: "crypto",
      }),
    ];

    const flows = ensureHubToUnlinkedAssets(components, [
      {
        id: "flow_1",
        sourceComponentId: "main",
        targetComponentId: "bcrypt",
        type: "api_call",
        confidence: 0.9,
      },
    ]);

    expect(flows).toHaveLength(3);
    const authFlows = flows.filter(
      (f) => f.enrichmentNotes === "auth_service_hub_link",
    );
    expect(authFlows.map((f) => f.targetComponentId).sort()).toEqual([
      "devise",
      "jwt",
    ]);
    expect(authFlows.every((f) => f.confidence === 0.75)).toBe(true);
  });

  it("does not duplicate an existing auth flow", () => {
    const components: DetectedComponent[] = [
      comp({
        id: "main",
        name: "App",
        type: "asset",
        properties: { isMainApplication: true },
      }),
      comp({
        id: "jwt",
        name: "Jwt",
        type: "asset",
        subType: "auth_service",
      }),
    ];

    const flows = ensureHubToUnlinkedAssets(components, [
      {
        id: "flow_1",
        sourceComponentId: "main",
        targetComponentId: "jwt",
        type: "api_call",
        confidence: 0.9,
      },
    ]);

    expect(flows).toHaveLength(1);
  });

  it("catch-all links arbitrary unlinked asset subtypes at lower confidence", () => {
    const components: DetectedComponent[] = [
      comp({
        id: "main",
        name: "App",
        type: "asset",
        subType: "api",
        properties: { isMainApplication: true },
      }),
      comp({
        id: "bcrypt",
        name: "Bcrypt",
        type: "asset",
        subType: "crypto",
      }),
      comp({
        id: "custom",
        name: "Weird Thing",
        type: "asset",
        subType: "custom_subtype",
      }),
    ];

    const flows = ensureHubToUnlinkedAssets(components, [
      {
        id: "flow_1",
        sourceComponentId: "main",
        targetComponentId: "bcrypt",
        type: "api_call",
        confidence: 0.9,
      },
    ]);

    expect(flows).toHaveLength(2);
    const catchAll = flows.find((f) => f.targetComponentId === "custom");
    expect(catchAll?.enrichmentNotes).toBe("unlinked_asset_hub_link");
    expect(catchAll?.confidence).toBe(0.55);
    expect(catchAll?.sourceComponentId).toBe("main");
  });

  it("skips synthetic section API nodes in catch-all", () => {
    const components: DetectedComponent[] = [
      comp({
        id: "main",
        name: "App",
        type: "asset",
        properties: { isMainApplication: true, section_id: "svc" },
      }),
      comp({
        id: "synthetic_api",
        name: "svc API",
        type: "asset",
        subType: "api",
        properties: {
          section_id: "svc",
          isSectionApiNode: true,
        },
      }),
    ];

    const flows = ensureHubToUnlinkedAssets(components, []);
    expect(flows).toHaveLength(0);
  });
});
