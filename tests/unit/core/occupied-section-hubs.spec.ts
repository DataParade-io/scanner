import type { DetectedComponent } from "../../../src/core/types/component";
import {
  ensureApplicationHubsForOccupiedSections,
  INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
} from "../../../src/classifier/application-injection";
import { enhanceComponents } from "../../../src/classifier/enhance";
import {
  ensureHubToOrphanThirdPartyFlows,
  postprocessDataFlows,
} from "../../../src/data-flow";

function tp(
  id: string,
  name: string,
  sectionId: string,
): DetectedComponent {
  return {
    id,
    name,
    type: "third_party",
    subType: "saas_service",
    confidence: 0.9,
    detectedFrom: [],
    sourceLocations: [],
    properties: {
      section_id: sectionId,
      section_label: sectionId,
      section_role: "service",
    },
  };
}

describe("ensureApplicationHubsForOccupiedSections", () => {
  it("injects a main-app hub for third_party-only occupied sections", () => {
    const components = [
      tp("tp_openai", "Openai", "tooling"),
      tp("tp_sentry", "Sentry", "tooling"),
    ];

    const withHubs = ensureApplicationHubsForOccupiedSections(components);
    const enhanced = enhanceComponents(withHubs);

    const hub = enhanced.find(
      (c) =>
        c.type === "asset" &&
        c.properties?.section_id === "tooling" &&
        (c.properties?.isMainApplication === true ||
          c.properties?.isMainApplication === "true"),
    );

    expect(hub).toBeDefined();
    expect(hub?.name).toBe("tooling");
    expect(hub?.properties?.sourceContext).toBe(
      INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
    );
  });

  it("does not duplicate hubs when a candidate already exists", () => {
    const components: DetectedComponent[] = [
      {
        id: "cmp_app",
        name: "scripts",
        type: "asset",
        subType: "application",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "scripts",
          section_label: "scripts",
          isMainApplication: true,
        },
      },
      tp("tp_1", "Stripe", "scripts"),
    ];

    const withHubs = ensureApplicationHubsForOccupiedSections(components);
    const hubs = withHubs.filter(
      (c) =>
        c.type === "asset" &&
        c.properties?.section_id === "scripts" &&
        c.properties?.sourceContext ===
          INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
    );
    expect(hubs).toHaveLength(0);
    expect(withHubs).toHaveLength(2);
  });

  it("skips terraform stack section ids", () => {
    const components = [
      tp("tp_aws", "Aws", "terraform/modules/vpc"),
    ];
    const withHubs = ensureApplicationHubsForOccupiedSections(components);
    expect(withHubs).toHaveLength(1);
  });
});

describe("ensureHubToOrphanThirdPartyFlows", () => {
  it("connects section hub to orphan third parties", () => {
    const components: DetectedComponent[] = [
      {
        id: "cmp_cli",
        name: "cli",
        type: "asset",
        subType: "application",
        confidence: 1,
        detectedFrom: [],
        sourceLocations: [],
        properties: {
          section_id: "cli",
          section_label: "cli",
          isMainApplication: true,
          sourceContext: INJECTED_PROJECT_PLACEHOLDER_SOURCE_CONTEXT,
        },
      },
      tp("tp_openai", "Openai", "cli"),
      tp("tp_sentry", "Sentry", "cli"),
    ];

    const flows = ensureHubToOrphanThirdPartyFlows(components, []);
    expect(flows).toHaveLength(2);
    expect(
      flows.every(
        (f) =>
          f.sourceComponentId === "cmp_cli" &&
          f.type === "api_call" &&
          f.enrichmentNotes === "section_hub_orphan_third_party",
      ),
    ).toBe(true);

    const post = postprocessDataFlows(components, []);
    expect(
      post.filter(
        (f) =>
          f.sourceComponentId === "cmp_cli" &&
          (f.targetComponentId === "tp_openai" ||
            f.targetComponentId === "tp_sentry"),
      ),
    ).toHaveLength(2);
  });
});
