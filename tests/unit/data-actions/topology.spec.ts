import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import type { DataActionAssignment } from "../../../src/core/types/data-action";
import {
  deriveFromTopology,
  runDataActionPhase,
  readDataActions,
  hasVerb,
} from "../../../src/data-actions";

function makeComponent(
  overrides: Partial<DetectedComponent> &
    Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return {
    subType: undefined,
    confidence: 1,
    detectedFrom: [],
    sourceLocations: [],
    properties: {},
    ...overrides,
  };
}

function makeFlow(
  overrides: Partial<DetectedDataFlow> &
    Pick<DetectedDataFlow, "id" | "sourceComponentId" | "targetComponentId">,
): DetectedDataFlow {
  return {
    type: "api_call",
    confidence: 1,
    ...overrides,
  };
}

function verbs(component: DetectedComponent): string[] {
  return readDataActions(component).map((a) => a.action).sort();
}

function assignment(
  component: DetectedComponent,
  action: string,
): DataActionAssignment | undefined {
  return readDataActions(component).find((a) => a.action === action);
}

describe("deriveFromTopology / runDataActionPhase", () => {
  describe("collect (≥3 positives)", () => {
    it("assigns collect on asset target of actor→api edge", () => {
      const actor = makeComponent({ id: "a1", name: "User", type: "actor", subType: "customer" });
      const api = makeComponent({ id: "api1", name: "api", type: "asset", subType: "api" });
      const flows = [makeFlow({ id: "f1", sourceComponentId: "a1", targetComponentId: "api1" })];
      runDataActionPhase([actor, api], flows);
      expect(hasVerb(api, "collect", { assertedOnly: true })).toBe(true);
      expect(assignment(api, "collect")?.evidence).toMatchObject({
        kind: "inbound_from_actor",
      });
      expect(actor.properties.dataActions).toBeUndefined();
    });

    it("assigns collect on third_party target of actor inbound", () => {
      const actor = makeComponent({ id: "a1", name: "User", type: "actor" });
      const tp = makeComponent({
        id: "seg",
        name: "segment",
        type: "third_party",
        subType: "analytics",
      });
      runDataActionPhase(
        [actor, tp],
        [makeFlow({ id: "f1", sourceComponentId: "a1", targetComponentId: "seg" })],
      );
      expect(hasVerb(tp, "collect", { assertedOnly: true })).toBe(true);
    });

    it("dedupes multiple inbound actors to one collect assignment", () => {
      const a1 = makeComponent({ id: "a1", name: "User", type: "actor" });
      const a2 = makeComponent({ id: "a2", name: "Admin", type: "actor", subType: "admin" });
      const api = makeComponent({ id: "api1", name: "api", type: "asset", subType: "api" });
      runDataActionPhase(
        [a1, a2, api],
        [
          makeFlow({ id: "f1", sourceComponentId: "a1", targetComponentId: "api1" }),
          makeFlow({ id: "f2", sourceComponentId: "a2", targetComponentId: "api1" }),
        ],
      );
      const collects = readDataActions(api).filter((x) => x.action === "collect");
      expect(collects).toHaveLength(1);
      expect(collects[0]!.status ?? "asserted").toBe("asserted");
    });
  });

  describe("store (≥3 positives)", () => {
    it("assigns store for database subtype", () => {
      const db = makeComponent({
        id: "pg",
        name: "pg",
        type: "asset",
        subType: "database",
      });
      runDataActionPhase([db], []);
      expect(hasVerb(db, "store", { assertedOnly: true })).toBe(true);
      expect(assignment(db, "store")?.evidence).toMatchObject({
        kind: "storage_subtype",
      });
    });

    it("assigns store for storage subtype (PRD cloud_storage)", () => {
      const bucket = makeComponent({
        id: "s3",
        name: "data",
        type: "asset",
        subType: "storage",
      });
      runDataActionPhase([bucket], []);
      expect(hasVerb(bucket, "store", { assertedOnly: true })).toBe(true);
    });

    it("assigns store and disclose together on database with outbound TP", () => {
      const app = makeComponent({
        id: "app",
        name: "app",
        type: "asset",
        subType: "database",
      });
      const stripe = makeComponent({
        id: "stripe",
        name: "stripe",
        type: "third_party",
        subType: "payment_processor",
      });
      runDataActionPhase(
        [app, stripe],
        [makeFlow({ id: "f1", sourceComponentId: "app", targetComponentId: "stripe" })],
      );
      expect(hasVerb(app, "store", { assertedOnly: true })).toBe(true);
      expect(hasVerb(app, "disclose", { assertedOnly: true })).toBe(true);
      expect(verbs(app)).toEqual(["disclose", "store"]);
    });
  });

  describe("disclose (≥3 positives)", () => {
    it("assigns disclose on asset source of outbound to stripe", () => {
      const app = makeComponent({ id: "app", name: "api", type: "asset", subType: "api" });
      const stripe = makeComponent({
        id: "stripe",
        name: "stripe",
        type: "third_party",
        subType: "payment_processor",
      });
      runDataActionPhase(
        [app, stripe],
        [makeFlow({ id: "f1", sourceComponentId: "app", targetComponentId: "stripe" })],
      );
      expect(hasVerb(app, "disclose", { assertedOnly: true })).toBe(true);
      expect(assignment(app, "disclose")?.evidence).toMatchObject({
        kind: "outbound_to_third_party",
        relatedComponentId: "stripe",
      });
    });

    it("assigns disclose on service → openai", () => {
      const svc = makeComponent({
        id: "svc",
        name: "risk",
        type: "asset",
        subType: "service",
      });
      const openai = makeComponent({
        id: "openai",
        name: "openai",
        type: "third_party",
        subType: "ai_provider",
      });
      runDataActionPhase(
        [svc, openai],
        [makeFlow({ id: "f1", sourceComponentId: "svc", targetComponentId: "openai" })],
      );
      expect(hasVerb(svc, "disclose", { assertedOnly: true })).toBe(true);
    });

    it("assigns disclose when third_party sources another third_party", () => {
      const gateway = makeComponent({
        id: "gw",
        name: "partner-gw",
        type: "third_party",
        subType: "saas_service",
      });
      const stripe = makeComponent({
        id: "stripe",
        name: "stripe",
        type: "third_party",
        subType: "payment_processor",
      });
      runDataActionPhase(
        [gateway, stripe],
        [makeFlow({ id: "f1", sourceComponentId: "gw", targetComponentId: "stripe" })],
      );
      expect(hasVerb(gateway, "disclose", { assertedOnly: true })).toBe(true);
    });
  });

  describe("relay (≥3 candidate positives)", () => {
    function relayGraph(id: string): {
      components: DetectedComponent[];
      flows: DetectedDataFlow[];
      proxy: DetectedComponent;
    } {
      const upstream = makeComponent({
        id: `${id}-in`,
        name: "in",
        type: "asset",
        subType: "api",
      });
      const proxy = makeComponent({
        id: id,
        name: id,
        type: "asset",
        subType: "service",
      });
      const downstream = makeComponent({
        id: `${id}-out`,
        name: "out",
        type: "third_party",
        subType: "saas_service",
      });
      const flows = [
        makeFlow({
          id: `${id}-f1`,
          sourceComponentId: upstream.id,
          targetComponentId: proxy.id,
        }),
        makeFlow({
          id: `${id}-f2`,
          sourceComponentId: proxy.id,
          targetComponentId: downstream.id,
        }),
      ];
      return { components: [upstream, proxy, downstream], flows, proxy };
    }

    it("emits relay candidate for proxy-a with in+out and no store/use", () => {
      const g = relayGraph("proxy-a");
      runDataActionPhase(g.components, g.flows);
      const relay = assignment(g.proxy, "relay");
      expect(relay?.status).toBe("candidate");
      expect(relay?.evidence).toMatchObject({ kind: "relay_topology" });
    });

    it("emits relay candidate for proxy-b", () => {
      const g = relayGraph("proxy-b");
      runDataActionPhase(g.components, g.flows);
      expect(assignment(g.proxy, "relay")?.status).toBe("candidate");
    });

    it("emits relay candidate for proxy-c", () => {
      const g = relayGraph("proxy-c");
      runDataActionPhase(g.components, g.flows);
      expect(assignment(g.proxy, "relay")?.status).toBe("candidate");
    });

    it("suppresses relay candidate when node already has store", () => {
      const upstream = makeComponent({ id: "u", name: "u", type: "asset", subType: "api" });
      const db = makeComponent({
        id: "db",
        name: "db",
        type: "asset",
        subType: "database",
      });
      const tp = makeComponent({
        id: "tp",
        name: "tp",
        type: "third_party",
        subType: "saas_service",
      });
      runDataActionPhase(
        [upstream, db, tp],
        [
          makeFlow({ id: "f1", sourceComponentId: "u", targetComponentId: "db" }),
          makeFlow({ id: "f2", sourceComponentId: "db", targetComponentId: "tp" }),
        ],
      );
      expect(hasVerb(db, "store", { assertedOnly: true })).toBe(true);
      expect(assignment(db, "relay")).toBeUndefined();
    });

    it("never asserts topology-only relay", () => {
      const g = relayGraph("proxy-assert");
      const proposed = deriveFromTopology(g.components, g.flows);
      const relays = [...proposed.values()]
        .flat()
        .filter((a) => a.action === "relay");
      expect(relays.length).toBeGreaterThan(0);
      expect(relays.every((a) => a.status === "candidate")).toBe(true);
    });
  });

  describe("negatives / DA-1", () => {
    it("never attaches dataActions to actors", () => {
      const actor = makeComponent({ id: "a1", name: "User", type: "actor" });
      const api = makeComponent({ id: "api", name: "api", type: "asset", subType: "api" });
      runDataActionPhase(
        [actor, api],
        [makeFlow({ id: "f1", sourceComponentId: "a1", targetComponentId: "api" })],
      );
      expect(actor.properties.dataActions).toBeUndefined();
      expect(verbs(actor)).toEqual([]);
    });

    it("does not assign store for api subtype alone", () => {
      const api = makeComponent({ id: "api", name: "api", type: "asset", subType: "api" });
      runDataActionPhase([api], []);
      expect(hasVerb(api, "store")).toBe(false);
    });

    it("does not assign disclose without outbound to third_party", () => {
      const a = makeComponent({ id: "a", name: "a", type: "asset", subType: "api" });
      const b = makeComponent({ id: "b", name: "b", type: "asset", subType: "service" });
      runDataActionPhase(
        [a, b],
        [makeFlow({ id: "f1", sourceComponentId: "a", targetComponentId: "b" })],
      );
      expect(hasVerb(a, "disclose")).toBe(false);
    });
  });
});
