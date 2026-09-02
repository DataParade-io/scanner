import type { DetectedComponent } from "../../../src/core/types/component";
import type { DataActionAssignment } from "../../../src/core/types/data-action";
import {
  DATA_ACTIONS,
  mergeAssignmentsOntoComponents,
  mergeOneAssignment,
  readDataActions,
  runDataActionPhase,
} from "../../../src/data-actions";
import type { DataAction } from "../../../src/data-actions";

function makeAsset(
  id: string,
  overrides: Partial<DetectedComponent> = {},
): DetectedComponent {
  return {
    id,
    name: id,
    type: "asset",
    subType: "api",
    confidence: 1,
    detectedFrom: [],
    sourceLocations: [],
    properties: {},
    ...overrides,
  };
}

function assignment(
  action: DataAction,
  overrides: Partial<DataActionAssignment> = {},
): DataActionAssignment {
  return {
    action,
    source: "deterministic",
    confidence: 1,
    evidence: {
      kind: "pattern_rule",
      description: `seeded ${action}`,
      ruleId: `seed-${action}`,
    },
    status: "asserted",
    ...overrides,
  };
}

describe("mergeAssignmentsOntoComponents (set-valued, all 11)", () => {
  it("keeps all 11 verbs coexisting after topology merge overlap", () => {
    const asset = makeAsset("all11", { subType: "database" });
    asset.properties.dataActions = DATA_ACTIONS.map((action) =>
      assignment(action, {
        status: action === "relay" ? "candidate" : "asserted",
        evidence:
          action === "relay"
            ? {
                kind: "relay_topology",
                description: "seeded relay candidate",
              }
            : {
                kind: "pattern_rule",
                description: `seeded ${action}`,
                ruleId: `seed-${action}`,
              },
      }),
    );

    const stripe = makeAsset("stripe");
    stripe.type = "third_party";
    stripe.subType = "payment_processor";

    runDataActionPhase(
      [asset, stripe],
      [
        {
          id: "f1",
          sourceComponentId: "all11",
          targetComponentId: "stripe",
          type: "api_call",
          confidence: 1,
        },
      ],
    );

    const verbs = readDataActions(asset).map((a) => a.action).sort();
    expect(verbs).toEqual([...DATA_ACTIONS].sort());
    expect(readDataActions(asset)).toHaveLength(11);
    const relay = readDataActions(asset).find((a) => a.action === "relay");
    expect(relay?.status).toBe("candidate");
    expect(
      readDataActions(asset).find((a) => a.action === "store")?.status ??
        "asserted",
    ).toBe("asserted");
    expect(
      readDataActions(asset).find((a) => a.action === "disclose")?.status ??
        "asserted",
    ).toBe("asserted");
  });

  it("checkout-like: collect + store + disclose + seeded log survive", () => {
    const checkout = makeAsset("checkout-api", { subType: "database" });
    checkout.properties.dataActions = [
      assignment("log", {
        evidence: [
          {
            filePath: "checkout.ts",
            startLine: 1,
            endLine: 1,
            code: "logger.info(email)",
          },
        ],
      }),
    ];
    const actor = makeAsset("user");
    actor.type = "actor";
    actor.subType = "customer";
    const stripe = makeAsset("stripe");
    stripe.type = "third_party";
    stripe.subType = "payment_processor";

    runDataActionPhase(
      [actor, checkout, stripe],
      [
        {
          id: "f1",
          sourceComponentId: "user",
          targetComponentId: "checkout-api",
          type: "api_call",
          confidence: 1,
        },
        {
          id: "f2",
          sourceComponentId: "checkout-api",
          targetComponentId: "stripe",
          type: "api_call",
          confidence: 1,
        },
      ],
    );

    const verbs = readDataActions(checkout).map((a) => a.action).sort();
    expect(verbs).toEqual(["collect", "disclose", "log", "store"]);
    expect(actor.properties.dataActions).toBeUndefined();
  });

  it("edge-proxy-like: relay stays candidate beside seeded log", () => {
    const proxy = makeAsset("edge-proxy", { subType: "service" });
    proxy.properties.dataActions = [assignment("log")];
    const upstream = makeAsset("edge-in", { subType: "api" });
    const tp = makeAsset("billing");
    tp.type = "third_party";
    tp.subType = "saas_service";

    runDataActionPhase(
      [upstream, proxy, tp],
      [
        {
          id: "f1",
          sourceComponentId: "edge-in",
          targetComponentId: "edge-proxy",
          type: "api_call",
          confidence: 1,
        },
        {
          id: "f2",
          sourceComponentId: "edge-proxy",
          targetComponentId: "billing",
          type: "api_call",
          confidence: 1,
        },
      ],
    );

    const verbs = readDataActions(proxy).map((a) => a.action).sort();
    expect(verbs).toContain("log");
    expect(verbs).toContain("relay");
    expect(verbs).toContain("disclose");
    expect(readDataActions(proxy).find((a) => a.action === "relay")?.status).toBe(
      "candidate",
    );
  });

  it("hash-writer / crm-sync-like: seeded transform|combine + topology store", () => {
    const hasher = makeAsset("hash-writer", { subType: "database" });
    hasher.properties.dataActions = [assignment("transform")];
    const crm = makeAsset("crm-sync", { subType: "database" });
    crm.properties.dataActions = [assignment("combine")];

    runDataActionPhase([hasher, crm], []);

    expect(
      readDataActions(hasher)
        .map((a) => a.action)
        .sort(),
    ).toEqual(["store", "transform"]);
    expect(
      readDataActions(crm)
        .map((a) => a.action)
        .sort(),
    ).toEqual(["combine", "store"]);
  });

  it("asserted beats candidate for the same verb", () => {
    const merged = mergeOneAssignment(
      [
        assignment("store", {
          status: "candidate",
          confidence: 0.4,
          evidence: { kind: "storage_subtype", description: "weak" },
        }),
      ],
      assignment("store", {
        status: "asserted",
        confidence: 1,
        evidence: { kind: "storage_subtype", description: "database" },
      }),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.status).toBe("asserted");
    expect(merged[0]!.confidence).toBe(1);
  });

  it("does not overwrite user provenance with deterministic", () => {
    const userStore = assignment("store", {
      source: "user",
      confidence: 1,
      evidence: { kind: "storage_subtype", description: "user confirmed" },
    });
    const merged = mergeOneAssignment(
      [userStore],
      assignment("store", {
        source: "deterministic",
        evidence: { kind: "storage_subtype", description: "database" },
      }),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("user");
    expect(merged[0]!.evidence).toEqual(userStore.evidence);
  });

  it("never writes dataActions onto actors and strips accidental ones", () => {
    const actor: DetectedComponent = {
      id: "actor",
      name: "User",
      type: "actor",
      confidence: 1,
      detectedFrom: [],
      sourceLocations: [],
      properties: {
        dataActions: [assignment("collect")],
      },
    };
    mergeAssignmentsOntoComponents(
      [actor],
      new Map([["actor", [assignment("store")]]]),
    );
    expect(actor.properties.dataActions).toBeUndefined();
  });

  it("refuses to promote relay to asserted without corroboration", () => {
    const merged = mergeOneAssignment(
      [
        assignment("relay", {
          status: "candidate",
          evidence: { kind: "relay_topology", description: "topology" },
        }),
      ],
      assignment("relay", {
        status: "asserted",
        evidence: { kind: "relay_topology", description: "still no proof" },
      }),
    );
    expect(merged[0]!.status).toBe("candidate");
  });
});
