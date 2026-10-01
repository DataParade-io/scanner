import fs from "fs";
import os from "os";
import path from "path";

import { createDefaultScanConfiguration, scan } from "../../../src/core/pipeline/orchestrator";
import { buildDataParadeGraph, DP_PREFIX } from "../../../src/graph/build-dataparade-graph";
import { loadGraphifyGraph } from "../../../src/structure/graphify";

const FIXTURES = path.join(__dirname, "../../fixtures/graphify");

describe("DataParade knowledge graph", () => {
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "dp-graph-"));
    fs.mkdirSync(path.join(root, "src"));
    fs.copyFileSync(path.join(FIXTURES, "users.ts.txt"), path.join(root, "src", "users.ts"));
  });

  async function build() {
    const result = await scan(root, createDefaultScanConfiguration({ enableAiInference: false }));
    const structure = loadGraphifyGraph(path.join(FIXTURES, "users-graph.json"));
    return { result, structure, graph: await buildDataParadeGraph(result, { structure }) };
  }

  it("emits node-link JSON compatible with graphify's loader", async () => {
    const { graph } = await build();
    expect(graph.directed).toBe(true);
    expect(graph.graph.schema).toBe("dataparade-graph/1");
    for (const node of graph.nodes) {
      expect(node.id.startsWith(DP_PREFIX)).toBe(true);
      expect(node.file_type).toBe("concept");
      expect(typeof node.label).toBe("string");
      expect("source_file" in node).toBe(true);
    }
    for (const link of graph.links) {
      expect(["EXTRACTED", "INFERRED", "AMBIGUOUS"]).toContain(link.confidence);
    }
    expect(graph.nodes.some((node) => node.dp_kind === "data_item" && node.id === "dp::data_item:email")).toBe(true);
  });

  it("bridges each occurrence to the graphify node that encloses it", async () => {
    const { graph, structure } = await build();
    const graphifyIds = new Set(structure.nodes.map((node) => node.id));
    const occursIn = graph.links.filter((link) => link.relation === "occurs_in");
    expect(occursIn.length).toBeGreaterThan(0);
    for (const link of occursIn) expect(graphifyIds.has(link.target)).toBe(true);
    const targetAt = (line: number) =>
      occursIn.find((link) => link.source === `dp::occurrence:email:src/users.ts:${line}`)?.target;
    expect(targetAt(2)).toBe("src_users_users"); // class field email = ""
    expect(targetAt(3)).toBe("src_users_users_find"); // method find(email)
    expect(targetAt(5)).toBe("src_users_admin_email"); // module-level ADMIN_EMAIL
  });

  it("links occurrences to their group and data item with evidence", async () => {
    const { graph } = await build();
    const occurrenceOf = graph.links.filter((link) => link.relation === "occurrence_of");
    expect(occurrenceOf.length).toBeGreaterThan(0);
    for (const link of occurrenceOf) {
      expect(link.source_file).toBe("src/users.ts");
      expect(link.source_location).toMatch(/^L\d+$/);
    }
    const partOf = graph.links.filter((link) => link.relation === "part_of");
    for (const link of partOf) expect(link.target).toBe("dp::data_item:email");
  });
});
