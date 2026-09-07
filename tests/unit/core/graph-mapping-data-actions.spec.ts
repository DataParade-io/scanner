import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";
import {
  buildDiagramGraphFromScanResult,
  selectPrimaryDataAction,
} from "../../../src/core/pipeline/graph-mapping";
import { diagramGraphJsonSchema } from "../../../src/core/schema";
import type { DataActionAssignment } from "../../../src/core/types/data-action";
import type { ScanResult } from "../../../src/core/types";

function assignment(
  action: DataActionAssignment["action"],
  overrides: Partial<DataActionAssignment> = {},
): DataActionAssignment {
  return {
    action,
    source: "deterministic",
    confidence: 1,
    status: "asserted",
    evidence: {
      kind: "storage_subtype",
      description: `test ${action}`,
    },
    ...overrides,
  };
}

function privacyOf(node: { data?: unknown }): Record<string, unknown> {
  const data = node.data as Record<string, unknown> | undefined;
  return (data?.privacy as Record<string, unknown> | undefined) ?? {};
}

describe("graph-mapping dataActions export (task 1.8)", () => {
  it("selectPrimaryDataAction prefers higher confidence then name", () => {
    expect(
      selectPrimaryDataAction([
        assignment("disclose", { confidence: 0.5 }),
        assignment("store", { confidence: 0.9 }),
        assignment("log", { confidence: 0.9 }),
      ]),
    ).toBe("log"); // same confidence → lexicographic log < store
  });

  it("exports set-valued asserted dataActions under privacy + primaryDataAction", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "asset-1",
          name: "checkout",
          type: "asset",
          subType: "api",
          confidence: 1,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            dataActions: [
              assignment("disclose", { confidence: 0.8 }),
              assignment("store", { confidence: 1 }),
            ],
          },
        },
      ],
      dataFlows: [],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 10,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);
    const node = graph.nodes[0]!;
    const privacy = privacyOf(node);
    const actions = privacy.dataActions as DataActionAssignment[];

    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.action).sort()).toEqual(["disclose", "store"]);
    expect(privacy.primaryDataAction).toBe("store");
    expect((node.data as Record<string, unknown>).dataActions).toBeUndefined();
    expect((node.data as Record<string, unknown>).primaryDataAction).toBeUndefined();

    expect(diagramGraphJsonSchema.safeParse(graph).success).toBe(true);
  });

  it("does not export candidate-only relay as board facts", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "proxy-1",
          name: "edge-proxy",
          type: "asset",
          subType: "service",
          confidence: 1,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            dataActions: [
              assignment("relay", {
                status: "candidate",
                confidence: 1,
                evidence: {
                  kind: "relay_topology",
                  description: "topology-only",
                },
              }),
            ],
          },
        },
      ],
      dataFlows: [],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 10,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const graph = buildDiagramGraphFromScanResult(scanResult);
    const privacy = privacyOf(graph.nodes[0]!);
    expect(privacy.dataActions).toBeUndefined();
    expect(privacy.primaryDataAction).toBeUndefined();
  });

  it("exports only asserted verbs when mixed with candidates", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "proxy-2",
          name: "gw",
          type: "asset",
          subType: "service",
          confidence: 1,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            dataActions: [
              assignment("log", { confidence: 1 }),
              assignment("relay", {
                status: "candidate",
                evidence: {
                  kind: "relay_topology",
                  description: "topology-only",
                },
              }),
            ],
          },
        },
      ],
      dataFlows: [],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 10,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const privacy = privacyOf(buildDiagramGraphFromScanResult(scanResult).nodes[0]!);
    const actions = privacy.dataActions as DataActionAssignment[];
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe("log");
    expect(privacy.primaryDataAction).toBe("log");
  });

  it("never exports dataActions on actor nodes (DA-1)", () => {
    const scanResult: ScanResult = {
      components: [
        {
          id: "actor-1",
          name: "User",
          type: "actor",
          subType: "customer",
          confidence: 1,
          detectedFrom: [],
          sourceLocations: [],
          properties: {
            dataActions: [assignment("collect")],
          },
        },
      ],
      dataFlows: [],
      filesScanned: 1,
      filesSkipped: 0,
      totalLines: 10,
      scanDurationMs: 1,
      warnings: [],
      errors: [],
    };

    const node = buildDiagramGraphFromScanResult(scanResult).nodes[0]!;
    const privacy = privacyOf(node);
    expect(privacy.dataActions).toBeUndefined();
    expect(privacy.primaryDataAction).toBeUndefined();
    expect((node.data as Record<string, unknown>).dataActions).toBeUndefined();
  });

  it("typescript-basic smoke: database node privacy includes asserted store", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult } = await scan(fixturesRoot, config);
    const graph = buildDiagramGraphFromScanResult(scanResult);

    const pgNode =
      graph.nodes.find((n) => {
        const label = (n.data as { label?: string } | undefined)?.label;
        return typeof label === "string" && label.toLowerCase() === "pg";
      }) ??
      graph.nodes.find((n) => {
        const data = n.data as Record<string, unknown>;
        return data.componentSubType === "database";
      });

    expect(pgNode).toBeDefined();
    const privacy = privacyOf(pgNode!);
    const actions = privacy.dataActions as DataActionAssignment[] | undefined;
    expect(actions?.some((a) => a.action === "store")).toBe(true);
    expect(privacy.primaryDataAction).toBeDefined();
    expect(diagramGraphJsonSchema.safeParse(graph).success).toBe(true);
  }, 120_000);
});
