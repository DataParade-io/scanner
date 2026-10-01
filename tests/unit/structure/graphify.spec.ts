import fs from "fs";
import os from "os";
import path from "path";

import {
  isSupportedGraphifyVersion,
  loadGraphifyGraph,
  parseGraphifyVersion,
  runGraphify,
} from "../../../src/structure/graphify";

const FIXTURES = path.join(__dirname, "../../fixtures/graphify");

describe("graphify structure graph", () => {
  it("loads graph.json with links or with edges", () => {
    const withLinks = loadGraphifyGraph(path.join(FIXTURES, "users-graph.json"));
    const withEdges = loadGraphifyGraph(path.join(FIXTURES, "users-graph-edges.json"));
    expect(withLinks.nodes.map((node) => node.label).sort()).toEqual(
      [".find()", "ADMIN_EMAIL", "Users", "send()", "users.ts"].sort(),
    );
    expect(withLinks.links.length).toBeGreaterThan(0);
    expect(withEdges.links).toEqual(withLinks.links);
    expect(withLinks.nodes.every((node) => node.source_file === "src/users.ts")).toBe(true);
  });

  it("parses and range-checks versions", () => {
    expect(parseGraphifyVersion("graphify 0.9.73\nRun 'graphify --help'")).toBe("0.9.73");
    expect(parseGraphifyVersion("nothing here")).toBeUndefined();
    expect(isSupportedGraphifyVersion("0.9.73")).toBe(true);
    expect(isSupportedGraphifyVersion("0.9.80")).toBe(true);
    expect(isSupportedGraphifyVersion("0.9.72")).toBe(false);
    expect(isSupportedGraphifyVersion("0.10.0")).toBe(false);
  });

  it("warns, and does not throw, when the command is missing", async () => {
    const outcome = await runGraphify(os.tmpdir(), { enabled: true, command: "graphify-does-not-exist-xyz" });
    expect(outcome.info).toBeUndefined();
    expect(outcome.warnings).toEqual([
      "structure graph skipped: graphify command 'graphify-does-not-exist-xyz' is not available",
    ]);
  });

  it("stays silent when auto-detection finds no graphify", async () => {
    const previous = process.env.DATAPARADE_GRAPHIFY_COMMAND;
    process.env.DATAPARADE_GRAPHIFY_COMMAND = "graphify-does-not-exist-xyz";
    try {
      expect(await runGraphify(os.tmpdir(), {})).toEqual({ warnings: [] });
    } finally {
      if (previous === undefined) delete process.env.DATAPARADE_GRAPHIFY_COMMAND;
      else process.env.DATAPARADE_GRAPHIFY_COMMAND = previous;
    }
  });

  const liveCommand = process.env.DATAPARADE_GRAPHIFY_COMMAND;
  (liveCommand ? it : it.skip)(
    "runs a real graphify extract (set DATAPARADE_GRAPHIFY_COMMAND)",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "graphify-root-"));
      fs.mkdirSync(path.join(root, "src"));
      fs.copyFileSync(path.join(FIXTURES, "users.ts.txt"), path.join(root, "src", "users.ts"));
      const outcome = await runGraphify(root, { enabled: true, outDir: path.join(root, "out") });
      expect(outcome.warnings).toEqual([]);
      expect(outcome.info?.nodeCount).toBeGreaterThanOrEqual(5);
      expect(outcome.graph?.nodes.some((node) => node.label === "send()")).toBe(true);
    },
    120_000,
  );
});
