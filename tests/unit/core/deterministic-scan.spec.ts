import fs from "fs";
import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";

const DETERMINISTIC_SCAN_SOURCE = fs.readFileSync(
  path.join(__dirname, "../../../src/core/pipeline/deterministic-scan.ts"),
  "utf8",
);

const ORCHESTRATOR_SOURCE = fs.readFileSync(
  path.join(__dirname, "../../../src/core/pipeline/orchestrator.ts"),
  "utf8",
);

describe("core/pipeline/deterministic-scan - KDATAP-439908", () => {
  it("does not statically import ai-enrichment or tracing modules", () => {
    expect(DETERMINISTIC_SCAN_SOURCE).not.toMatch(/from ["'].*ai-enrichment/);
    expect(DETERMINISTIC_SCAN_SOURCE).not.toMatch(/from ["'].*tracing/);
    expect(ORCHESTRATOR_SOURCE).not.toMatch(/from ["'].*ai-enrichment/);
    expect(ORCHESTRATOR_SOURCE).not.toMatch(/from ["'].*tracing/);
  });

  it("produces stable results for the typescript-basic fixture", async () => {
    const fixturesRoot = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "typescript-basic",
    );

    const config = createDefaultScanConfiguration({ enableAiInference: false });

    const first = await scan(fixturesRoot, config);
    const second = await scan(fixturesRoot, config);

    const componentKey = (c: {
      id: string;
      type: string;
      name: string;
      subType?: string;
      properties?: Record<string, unknown>;
    }) =>
      [
        c.id,
        c.type,
        c.name,
        c.subType ?? "",
        c.properties?.subType ?? "",
      ].join(":");

    const firstComponents = first.scanResult.components.map(componentKey).sort();
    const secondComponents = second.scanResult.components.map(componentKey).sort();

    expect(firstComponents).toEqual(secondComponents);

    const flowKey = (f: {
      id: string;
      sourceComponentId: string;
      targetComponentId: string;
      type: string;
    }) => [f.id, f.sourceComponentId, f.targetComponentId, f.type].join(":");

    const firstFlows = first.scanResult.dataFlows.map(flowKey).sort();
    const secondFlows = second.scanResult.dataFlows.map(flowKey).sort();

    expect(firstFlows).toEqual(secondFlows);
  });
});
