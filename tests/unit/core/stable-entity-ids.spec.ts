import fs from "fs";
import os from "os";
import path from "path";

import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import type { ScanResult } from "../../../src/core/types/result";
import {
  assignStableEntityIds,
  assignStableEntityIdsWithMaps,
  buildComponentKeyById,
  stableComponentId,
  stableFlowId,
  STABLE_COMPONENT_ID_PATTERN,
  STABLE_FLOW_ID_PATTERN,
} from "../../../src/core/pipeline/stable-entity-ids";
import * as publicApi from "../../../src/index";
import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";

function component(
  id: string,
  name: string,
  opts: {
    type?: DetectedComponent["type"];
    subType?: string;
    files?: Array<[string, number]>;
    properties?: Record<string, unknown>;
    dataFlowIds?: string[];
  } = {},
): DetectedComponent {
  return {
    id,
    name,
    type: opts.type ?? "asset",
    subType: opts.subType ?? "application",
    confidence: 0.9,
    detectedFrom: [],
    sourceLocations: (opts.files ?? []).map(([filePath, line]) => ({
      filePath,
      startLine: line,
      endLine: line + 2,
    })),
    properties: { section_id: "root", ...(opts.properties ?? {}) },
    ...(opts.dataFlowIds ? { dataFlowIds: opts.dataFlowIds } : {}),
  };
}

function flow(
  id: string,
  source: string,
  target: string,
  opts: Partial<DetectedDataFlow> & { file?: [string, number] } = {},
): DetectedDataFlow {
  const { file, ...rest } = opts;
  return {
    id,
    sourceComponentId: source,
    targetComponentId: target,
    type: "api_call",
    confidence: 0.8,
    ...(file
      ? {
          sourceLocation: { filePath: file[0], startLine: file[1], endLine: file[1] },
          sourceLocations: [{ filePath: file[0], startLine: file[1], endLine: file[1] }],
        }
      : {}),
    ...rest,
  };
}

function scanResultOf(
  components: DetectedComponent[],
  dataFlows: DetectedDataFlow[],
  extra: Partial<ScanResult> = {},
): ScanResult {
  return {
    components,
    dataFlows,
    filesScanned: 1,
    filesSkipped: 0,
    totalLines: 1,
    scanDurationMs: 1,
    warnings: [],
    errors: [],
    ...extra,
  };
}

/** Maps a human label (component name / flow description) to its assigned id. */
function idsByLabel(result: ScanResult): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of result.components) out[`c:${c.name}`] = c.id;
  for (const f of result.dataFlows) out[`f:${f.description ?? f.id}`] = f.id;
  return out;
}

function baseScan(): ScanResult {
  const user = component("cmp_1", "User", { type: "actor", subType: "customer" });
  const api = component("cmp_2", "API", { subType: "api", files: [["src/server.ts", 10]] });
  const db = component("cmp_3", "Postgres", { subType: "database", files: [["src/db.ts", 4]] });
  const stripe = component("cmp_4", "Stripe", {
    type: "third_party",
    subType: "payment_processor",
    files: [["src/pay.ts", 7]],
  });
  return scanResultOf(
    [user, api, db, stripe],
    [
      flow("flow_1", "cmp_1", "cmp_2", { description: "user->api", file: ["src/server.ts", 12] }),
      flow("flow_2", "cmp_2", "cmp_3", {
        description: "api->db",
        type: "database_query",
        file: ["src/db.ts", 20],
      }),
      flow("flow_3", "cmp_2", "cmp_4", {
        description: "api->stripe",
        method: "post",
        endpoint: "https://api.stripe.com/v1/customers/",
        file: ["src/pay.ts", 9],
      }),
    ],
  );
}

function expectReferentialIntegrity(result: ScanResult): void {
  const componentIds = new Set(result.components.map((c) => c.id));
  const flowIds = new Set(result.dataFlows.map((f) => f.id));
  expect(componentIds.size).toBe(result.components.length);
  expect(flowIds.size).toBe(result.dataFlows.length);
  for (const c of result.components) {
    expect(c.id).toMatch(STABLE_COMPONENT_ID_PATTERN);
    for (const id of c.dataFlowIds ?? []) expect(flowIds.has(id)).toBe(true);
    const managedBy = c.properties.managed_by_provider;
    if (typeof managedBy === "string") expect(componentIds.has(managedBy)).toBe(true);
  }
  for (const f of result.dataFlows) {
    expect(f.id).toMatch(STABLE_FLOW_ID_PATTERN);
    expect(componentIds.has(f.sourceComponentId)).toBe(true);
    expect(componentIds.has(f.targetComponentId)).toBe(true);
  }
}

describe("stable-entity-ids", () => {
  it("mints cmp_/flow_ + 12 hex ids that match the standalone helpers", () => {
    const input = baseScan();
    const { scanResult: out, componentKeyById } = assignStableEntityIdsWithMaps(input);

    expectReferentialIntegrity(out);
    input.components.forEach((c, i) => {
      expect(out.components[i]?.id).toBe(stableComponentId(c));
    });
    for (const f of out.dataFlows) {
      expect(stableFlowId(f, componentKeyById)).toBe(f.id);
    }
    // CLI path: keys rebuilt from a finalized result reproduce the flow ids.
    const rebuilt = buildComponentKeyById(out.components);
    for (const f of out.dataFlows) expect(stableFlowId(f, rebuilt)).toBe(f.id);
  });

  it("does not change existing ids when an unrelated component or flow is added or removed", () => {
    const before = idsByLabel(assignStableEntityIds(baseScan()));

    const grown = baseScan();
    grown.components.unshift(
      component("cmp_0", "Sendgrid", {
        type: "third_party",
        subType: "saas_service",
        files: [["src/aaa-mail.ts", 1]],
      }),
    );
    grown.dataFlows.unshift(
      flow("flow_0", "cmp_2", "cmp_0", { description: "api->sendgrid", file: ["src/aaa-mail.ts", 2] }),
    );
    const after = idsByLabel(assignStableEntityIds(grown));
    for (const [label, id] of Object.entries(before)) expect(after[label]).toBe(id);
    expect(Object.keys(after)).toHaveLength(Object.keys(before).length + 2);

    const shrunk = baseScan();
    shrunk.components = shrunk.components.filter((c) => c.name !== "Postgres");
    shrunk.dataFlows = shrunk.dataFlows.filter((f) => f.description !== "api->db");
    const afterRemoval = idsByLabel(assignStableEntityIds(shrunk));
    for (const [label, id] of Object.entries(afterRemoval)) expect(before[label]).toBe(id);
  });

  it("is independent of input order and of the transient ids detection assigned", () => {
    const a = assignStableEntityIds(baseScan());

    const shuffled = baseScan();
    const rename = new Map(shuffled.components.map((c, i) => [c.id, `cmp_${90 - i}`]));
    shuffled.components = shuffled.components
      .map((c) => ({ ...c, id: rename.get(c.id) as string }))
      .reverse();
    shuffled.dataFlows = shuffled.dataFlows
      .map((f, i) => ({
        ...f,
        id: `flow_${50 + i}`,
        sourceComponentId: rename.get(f.sourceComponentId) as string,
        targetComponentId: rename.get(f.targetComponentId) as string,
      }))
      .reverse();
    const b = assignStableEntityIds(shuffled);

    expect(idsByLabel(b)).toEqual(idsByLabel(a));
  });

  it("ignores line-number edits within a file but tracks file, method and endpoint", () => {
    const before = idsByLabel(assignStableEntityIds(baseScan()));

    const edited = baseScan();
    for (const c of edited.components) {
      c.sourceLocations = c.sourceLocations.map((l) => ({
        ...l,
        startLine: l.startLine + 40,
        endLine: l.endLine + 40,
      }));
    }
    for (const f of edited.dataFlows) {
      f.sourceLocation = f.sourceLocation && { ...f.sourceLocation, startLine: 99, endLine: 101 };
      f.sourceLocations = f.sourceLocations?.map((l) => ({ ...l, startLine: 99, endLine: 101 }));
    }
    expect(idsByLabel(assignStableEntityIds(edited))).toEqual(before);

    // Normalization: method case and a trailing slash on the endpoint do not matter.
    const normalized = baseScan();
    const stripeFlow = normalized.dataFlows.find((f) => f.description === "api->stripe")!;
    stripeFlow.method = "POST";
    stripeFlow.endpoint = "  https://api.stripe.com/v1/customers ";
    expect(idsByLabel(assignStableEntityIds(normalized))["f:api->stripe"]).toBe(
      before["f:api->stripe"],
    );

    const changed = baseScan();
    const moved = changed.dataFlows.find((f) => f.description === "api->stripe")!;
    moved.endpoint = "https://api.stripe.com/v1/charges";
    expect(idsByLabel(assignStableEntityIds(changed))["f:api->stripe"]).not.toBe(
      before["f:api->stripe"],
    );
  });

  it("disambiguates colliding components and flows deterministically", () => {
    // Same app tuple (section/type/subType/first file/name) → same key → same hash.
    const twinA = component("cmp_a", "Worker", { files: [["src/worker.ts", 5]] });
    const twinB = component("cmp_b", "Worker", { files: [["src/worker.ts", 5], ["src/z.ts", 1]] });
    const sink = component("cmp_c", "Queue", { subType: "queue", files: [["src/q.ts", 1]] });
    const flows = [
      flow("flow_1", "cmp_a", "cmp_c", { description: "a->q", file: ["src/worker.ts", 8] }),
      flow("flow_2", "cmp_b", "cmp_c", { description: "b->q", file: ["src/worker.ts", 8] }),
      // Two flows with identical identity (same file, different lines).
      flow("flow_3", "cmp_c", "cmp_a", { description: "q->a line 3", file: ["src/q.ts", 3] }),
      flow("flow_4", "cmp_c", "cmp_a", { description: "q->a line 30", file: ["src/q.ts", 30] }),
    ];

    const run = (order: number[], flowOrder: number[]) => {
      const comps = [twinA, twinB, sink];
      return assignStableEntityIds(
        scanResultOf(
          order.map((i) => comps[i]!),
          flowOrder.map((i) => flows[i]!),
        ),
      );
    };
    const first = run([0, 1, 2], [0, 1, 2, 3]);
    const second = run([2, 1, 0], [3, 2, 1, 0]);

    expectReferentialIntegrity(first);
    const workerIds = first.components.filter((c) => c.name === "Worker").map((c) => c.id).sort();
    expect(workerIds).toHaveLength(2);
    expect(workerIds[0]).toMatch(/^cmp_[0-9a-f]{12}$/);
    expect(workerIds[1]).toBe(`${workerIds[0]}_2`);

    const byDescription = (r: ScanResult) =>
      Object.fromEntries(r.dataFlows.map((f) => [f.description, f.id]));
    const firstFlows = byDescription(first);
    expect(new Set(Object.values(firstFlows)).size).toBe(4);
    expect(firstFlows["q->a line 30"]).toBe(`${firstFlows["q->a line 3"]}_2`);
    expect(firstFlows["a->q"]).not.toBe(firstFlows["b->q"]);

    // Same assignment regardless of input order.
    const componentIdOf = (r: ScanResult) =>
      Object.fromEntries(r.components.map((c) => [c.sourceLocations.length + c.name, c.id]));
    expect(componentIdOf(second)).toEqual(componentIdOf(first));
    expect(byDescription(second)).toEqual(firstFlows);
  });

  it("orders colliding flows by numeric position, so shifting lines does not swap suffixes", () => {
    const api = component("cmp_1", "API", { subType: "api", files: [["src/a.ts", 1]] });
    const run = (upperLine: number, lowerLine: number) =>
      Object.fromEntries(
        assignStableEntityIds(
          scanResultOf(
            [api],
            [
              flow("flow_2", "cmp_1", "cmp_1", { description: "lower", type: "data_transfer", file: ["src/a.ts", lowerLine] }),
              flow("flow_1", "cmp_1", "cmp_1", { description: "upper", type: "data_transfer", file: ["src/a.ts", upperLine] }),
            ],
          ),
        ).dataFlows.map((f) => [f.description, f.id]),
      );
    const before = run(95, 99);
    expect(before.lower).toBe(`${before.upper}_2`);
    // Crossing a digit boundary (99 → 105) must not reorder them.
    expect(run(101, 105)).toEqual(before);
  });

  it("rewrites every reference to component and flow ids", () => {
    const provider = component("cmp_7", "AWS", {
      type: "third_party",
      subType: "cloud_provider",
      properties: { terraform_address: "provider.aws" },
    });
    const managed = component("cmp_8", "Aws S3", {
      properties: { managed_by_provider: "cmp_7", managed_service_key: "s3" },
      dataFlowIds: ["flow_9", "flow_gone"],
    });
    managed.properties.dataActions = [
      {
        action: "store",
        source: "deterministic",
        confidence: 0.8,
        evidence: {
          kind: "inbound_from_actor",
          description: "x",
          dataFlowId: "flow_9",
          relatedComponentId: "cmp_7",
        },
      },
      {
        action: "relay",
        source: "deterministic",
        confidence: 0.5,
        evidence: {
          kind: "relay_topology",
          description: "dangling",
          dataFlowId: "flow_dropped",
          relatedComponentId: "cmp_dropped",
        },
      },
      {
        action: "store",
        source: "deterministic",
        confidence: 0.5,
        evidence: [{ filePath: "main.tf", startLine: 1, endLine: 2 }],
      },
    ];
    const input = scanResultOf(
      [provider, managed],
      [flow("flow_9", "cmp_7", "cmp_8", { type: "file_transfer" })],
      {
        aiInferenceSummary: {
          ran: true,
          candidatesConsidered: 0,
          proposalsGenerated: 0,
          proposalsApplied: 0,
          proposalsRejected: 0,
          proposalsGeneratedHeuristic: 0,
          proposalsAppliedHeuristic: 0,
          proposalsGeneratedProvider: 0,
          proposalsAppliedProvider: 0,
          providerCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          aiProvider: "none",
          aiModel: "none",
          thirdPartyDataFlow: {
            entries: [
              {
                componentId: "cmp_7",
                componentName: "AWS",
                capabilities: [],
                direction: "unknown",
                dataShared: [],
                confidence: 0.5,
                confidenceBand: "low",
                source: "heuristic",
                evidence: [],
              },
            ],
            totals: { thirdPartiesAnalyzed: 1, withDataShared: 0 },
          },
          agenticTrace: [
            { candidateId: "c1", componentId: "cmp_8", filesReviewed: [], rounds: 1, finalProposalCount: 0, toolCalls: [] },
          ],
        },
        aiInferenceProposalDetails: [
          {
            id: "p1",
            source: "heuristic",
            status: "applied",
            kind: "flow_patch",
            candidateType: "x",
            agent: "a",
            provider: "none",
            model: "none",
            confidence: 0.5,
            confidenceBand: "low",
            targetComponentId: "cmp_8",
            targetFlowId: "flow_9",
            sourceComponentId: "cmp_7",
            targetFlowComponentId: "cmp_8",
            evidence: [],
          },
        ],
      },
    );

    const { scanResult: out, componentIdMap, flowIdMap } = assignStableEntityIdsWithMaps(input);
    expectReferentialIntegrity(out);
    const awsId = componentIdMap.get("cmp_7")!;
    const s3Id = componentIdMap.get("cmp_8")!;
    const flowId = flowIdMap.get("flow_9")!;
    const s3 = out.components.find((c) => c.id === s3Id)!;

    expect(s3.properties.managed_by_provider).toBe(awsId);
    expect(s3.dataFlowIds).toEqual([flowId]);
    const actions = s3.properties.dataActions as Array<{ evidence: unknown }>;
    expect(actions[0]?.evidence).toMatchObject({ dataFlowId: flowId, relatedComponentId: awsId });
    expect(actions[1]?.evidence).toEqual({ kind: "relay_topology", description: "dangling" });
    expect(actions[2]?.evidence).toEqual([{ filePath: "main.tf", startLine: 1, endLine: 2 }]);
    expect(out.dataFlows[0]).toMatchObject({ id: flowId, sourceComponentId: awsId, targetComponentId: s3Id });
    expect(out.aiInferenceSummary?.thirdPartyDataFlow?.entries[0]?.componentId).toBe(awsId);
    expect(out.aiInferenceSummary?.agenticTrace?.[0]?.componentId).toBe(s3Id);
    expect(out.aiInferenceProposalDetails?.[0]).toMatchObject({
      targetComponentId: s3Id,
      targetFlowId: flowId,
      sourceComponentId: awsId,
      targetFlowComponentId: s3Id,
    });

    // Input is not mutated.
    expect(input.components[1]?.id).toBe("cmp_8");
    expect(input.components[1]?.properties.managed_by_provider).toBe("cmp_7");
  });

  it("keys managed services by their provider's identity, not its transient id", () => {
    const build = (providerId: string) =>
      assignStableEntityIds(
        scanResultOf(
          [
            component(providerId, "AWS", {
              type: "third_party",
              subType: "cloud_provider",
              properties: { terraform_address: "provider.aws" },
            }),
            component("cmp_s3", "Aws S3", {
              properties: { managed_by_provider: providerId, managed_service_key: "s3" },
            }),
          ],
          [],
        ),
      );
    const one = build("cmp_3");
    const two = build("cmp_41");
    expect(one.components.map((c) => c.id)).toEqual(two.components.map((c) => c.id));
  });

  it("is idempotent", () => {
    const once = assignStableEntityIds(baseScan());
    expect(assignStableEntityIds(once)).toEqual(once);
  });

  it("is exported from the package entry point", () => {
    expect(publicApi.assignStableEntityIds).toBe(assignStableEntityIds);
    expect(publicApi.stableComponentId).toBe(stableComponentId);
    expect(publicApi.stableFlowId).toBe(stableFlowId);
    expect(publicApi.buildComponentKeyById).toBe(buildComponentKeyById);
  });

  describe("full scan", () => {
    const fixture = path.join(__dirname, "..", "..", "fixtures", "typescript-basic");
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    let tmp: string | undefined;

    afterEach(() => {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    });

    it("produces content-derived ids with intact references, identical across runs", async () => {
      const first = await scan(fixture, config);
      const second = await scan(fixture, config);
      expect(first.scanResult.components.length).toBeGreaterThan(0);
      expect(first.scanResult.dataFlows.length).toBeGreaterThan(0);
      expectReferentialIntegrity(first.scanResult);
      expect(second.scanResult.components.map((c) => c.id)).toEqual(
        first.scanResult.components.map((c) => c.id),
      );
      expect(second.scanResult.dataFlows.map((f) => f.id)).toEqual(
        first.scanResult.dataFlows.map((f) => f.id),
      );
    });

    it("keeps existing ids when a new integration is added and lines shift", async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stable-ids-"));
      fs.cpSync(fixture, tmp, { recursive: true });
      const before = await scan(tmp, config);

      fs.writeFileSync(
        path.join(tmp, "aaa-mail.ts"),
        [
          "export async function sendMail() {",
          '  const res = await fetch("https://api.sendgrid.com/v3/mail/send", { method: "POST", body: "{}" });',
          "  return res.ok;",
          "}",
          "",
        ].join("\n"),
      );
      const external = path.join(tmp, "external-api.ts");
      fs.writeFileSync(external, `\n\n\n${fs.readFileSync(external, "utf8")}`);

      const after = await scan(tmp, config);
      expectReferentialIntegrity(after.scanResult);

      const afterComponentIds = new Set(after.scanResult.components.map((c) => c.id));
      const afterFlowIds = new Set(after.scanResult.dataFlows.map((f) => f.id));
      for (const c of before.scanResult.components) expect(afterComponentIds.has(c.id)).toBe(true);
      for (const f of before.scanResult.dataFlows) expect(afterFlowIds.has(f.id)).toBe(true);
      expect(after.scanResult.components.length).toBeGreaterThan(before.scanResult.components.length);
      expect(after.scanResult.dataFlows.length).toBeGreaterThan(before.scanResult.dataFlows.length);
    });
  });
});
