import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";
import type { DetectedComponent } from "../../../src/core/types/component";
import type { DataActionAssignment } from "../../../src/core/types/data-action";
import { readDataActions } from "../../../src/data-actions";

const FIXTURES_ROOT = path.join(__dirname, "../../fixtures");

function identity(component: DetectedComponent): string {
  return `${component.type}:${component.name.toLowerCase()}`;
}

function readAssignments(component: DetectedComponent): DataActionAssignment[] {
  return readDataActions(component);
}

function assertedVerbs(component: DetectedComponent): string[] {
  return readAssignments(component)
    .filter((a) => (a.status ?? "asserted") === "asserted")
    .map((a) => a.action)
    .sort();
}

function findByIdentity(
  components: DetectedComponent[],
  key: string,
): DetectedComponent | undefined {
  const needle = key.toLowerCase();
  return components.find((c) => identity(c) === needle);
}

function findBySubtype(
  components: DetectedComponent[],
  type: DetectedComponent["type"],
  subType: string,
): DetectedComponent[] {
  return components.filter((c) => c.type === type && c.subType === subType);
}

function hasAsserted(
  components: DetectedComponent[],
  action: string,
): boolean {
  return components.some((c) =>
    readAssignments(c).some(
      (a) => a.action === action && (a.status ?? "asserted") === "asserted",
    ),
  );
}

function assertedRelayWithoutCorroboration(
  components: DetectedComponent[],
): DetectedComponent[] {
  return components.filter((c) =>
    readAssignments(c).some((a) => {
      if (a.action !== "relay") return false;
      if ((a.status ?? "asserted") !== "asserted") return false;
      const evidence = a.evidence;
      if (Array.isArray(evidence)) return true;
      return !evidence.corroboration;
    }),
  );
}

async function scanFixture(fixture: string) {
  const root = path.join(FIXTURES_ROOT, fixture);
  const config = createDefaultScanConfiguration({ enableAiInference: false });
  const { scanResult } = await scan(root, config);
  return scanResult;
}

describe("topology data-actions across language fixtures", () => {
  it("typescript-basic: database store + stripe disclose path; no bad relay", async () => {
    const { components } = await scanFixture("typescript-basic");
    const pg =
      findByIdentity(components, "asset:pg") ??
      findBySubtype(components, "asset", "database")[0];
    expect(pg).toBeDefined();
    expect(assertedVerbs(pg!)).toContain("store");

    const stripe = findByIdentity(components, "third_party:stripe");
    expect(stripe).toBeDefined();

    // Disclose lands on the *source* of outbound-to-TP edges.
    const disclosers = components.filter((c) =>
      assertedVerbs(c).includes("disclose"),
    );
    expect(disclosers.length).toBeGreaterThan(0);

    expect(assertedRelayWithoutCorroboration(components)).toEqual([]);
    for (const actor of components.filter((c) => c.type === "actor")) {
      expect(actor.properties.dataActions).toBeUndefined();
    }
  }, 120_000);

  it("python-basic: DB store and/or OpenAI disclose when graph supports", async () => {
    const { components } = await scanFixture("python-basic");
    const databases = findBySubtype(components, "asset", "database");
    const openai = findByIdentity(components, "third_party:openai");

    if (databases.length > 0) {
      expect(databases.some((d) => assertedVerbs(d).includes("store"))).toBe(
        true,
      );
    } else {
      // Detector gap — still require actors clean and no bad relay.
      expect(hasAsserted(components, "store") || hasAsserted(components, "disclose")).toBe(
        true,
      );
    }

    if (openai) {
      const disclosers = components.filter((c) =>
        assertedVerbs(c).includes("disclose"),
      );
      expect(disclosers.length).toBeGreaterThan(0);
    }

    expect(assertedRelayWithoutCorroboration(components)).toEqual([]);
    for (const actor of components.filter((c) => c.type === "actor")) {
      expect(actor.properties.dataActions).toBeUndefined();
    }
  }, 120_000);

  it("data-actions-python: actors clean; store/disclose when present", async () => {
    const { components } = await scanFixture("data-actions-python");
    for (const actor of components.filter((c) => c.type === "actor")) {
      expect(actor.properties.dataActions).toBeUndefined();
    }
    expect(assertedRelayWithoutCorroboration(components)).toEqual([]);

    const databases = findBySubtype(components, "asset", "database");
    const storages = findBySubtype(components, "asset", "storage");
    for (const c of [...databases, ...storages]) {
      expect(assertedVerbs(c)).toContain("store");
    }
  }, 120_000);

  it("data-actions-php: actors clean; topology verbs when graph supports", async () => {
    const { components } = await scanFixture("data-actions-php");
    for (const actor of components.filter((c) => c.type === "actor")) {
      expect(actor.properties.dataActions).toBeUndefined();
    }
    expect(assertedRelayWithoutCorroboration(components)).toEqual([]);

    const databases = findBySubtype(components, "asset", "database");
    for (const c of databases) {
      expect(assertedVerbs(c)).toContain("store");
    }
  }, 120_000);

  it("java-basic: JDBC/database store + Stripe disclose path", async () => {
    const { components } = await scanFixture("java-basic");
    const databases = findBySubtype(components, "asset", "database");
    expect(databases.length).toBeGreaterThan(0);
    expect(databases.some((d) => assertedVerbs(d).includes("store"))).toBe(true);

    const stripe = findByIdentity(components, "third_party:stripe");
    expect(stripe).toBeDefined();
    const disclosers = components.filter((c) =>
      assertedVerbs(c).includes("disclose"),
    );
    expect(disclosers.length).toBeGreaterThan(0);
    expect(assertedRelayWithoutCorroboration(components)).toEqual([]);
  }, 120_000);

  it("terraform-basic: RDS + S3 store", async () => {
    const { components } = await scanFixture("terraform-basic");
    const databases = findBySubtype(components, "asset", "database");
    const storages = findBySubtype(components, "asset", "storage");
    expect(databases.length + storages.length).toBeGreaterThanOrEqual(2);

    const storeCount = [...databases, ...storages].filter((c) =>
      assertedVerbs(c).includes("store"),
    ).length;
    expect(storeCount).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it("dotnet-manifests-basic: Stripe/outbound disclose when flows exist", async () => {
    const { components, dataFlows } = await scanFixture("dotnet-manifests-basic");
    const stripe = findByIdentity(components, "third_party:stripe");
    expect(stripe).toBeDefined();

    const outboundToTp = dataFlows.filter((f) => {
      const target = components.find((c) => c.id === f.targetComponentId);
      return target?.type === "third_party";
    });

    if (outboundToTp.length > 0) {
      expect(hasAsserted(components, "disclose")).toBe(true);
    } else {
      // No outbound edges yet — topology disclose cannot fire; actors still clean.
      expect(assertedRelayWithoutCorroboration(components)).toEqual([]);
    }

    for (const actor of components.filter((c) => c.type === "actor")) {
      expect(actor.properties.dataActions).toBeUndefined();
    }
  }, 120_000);

  it("data-actions-basic: relay stays candidate when in+out proxy graph exists", async () => {
    const { components, dataFlows } = await scanFixture("data-actions-basic");
    expect(assertedRelayWithoutCorroboration(components)).toEqual([]);

    const byId = new Map(components.map((c) => [c.id, c]));
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();
    for (const flow of dataFlows) {
      inDegree.set(
        flow.targetComponentId,
        (inDegree.get(flow.targetComponentId) ?? 0) + 1,
      );
      outDegree.set(
        flow.sourceComponentId,
        (outDegree.get(flow.sourceComponentId) ?? 0) + 1,
      );
    }

    const relayCandidates = components.filter((c) =>
      readAssignments(c).some(
        (a) => a.action === "relay" && a.status === "candidate",
      ),
    );

    for (const c of relayCandidates) {
      expect((inDegree.get(c.id) ?? 0) > 0).toBe(true);
      expect((outDegree.get(c.id) ?? 0) > 0).toBe(true);
      expect(byId.get(c.id)?.type).not.toBe("actor");
    }

    for (const actor of components.filter((c) => c.type === "actor")) {
      expect(actor.properties.dataActions).toBeUndefined();
    }
  }, 120_000);
});
