import fs from "fs";
import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";
import type { DetectedComponent, DetectedDataFlow } from "../../../src/core/types";
import {
  exportScanDiscoveries,
  scanDiscoveryExportSchema,
} from "../../../src/discovery";

const FIXED_ASSERTED_AT = "2026-09-16T15:00:00.000Z";

function minimalScanResult(): {
  components: DetectedComponent[];
  dataFlows: DetectedDataFlow[];
} {
  return {
    components: [
      {
        id: "cmp_3",
        name: "Aws",
        type: "third_party",
        subType: "cloud_provider",
        confidence: 0.9,
        detectedFrom: [{ pattern: "terraform-aws-provider" }],
        sourceLocations: [
          { filePath: "infra/main.tf", startLine: 4, endLine: 8 },
        ],
        properties: { vendor: "aws" },
      },
      {
        id: "cmp_11",
        name: "Aws",
        type: "third_party",
        subType: "cloud_provider",
        confidence: 0.9,
        detectedFrom: [{ pattern: "terraform-aws-provider" }],
        sourceLocations: [
          { filePath: "packages/api/infra.tf", startLine: 2, endLine: 6 },
        ],
        properties: { vendor: "aws" },
      },
    ],
    dataFlows: [
      {
        id: "flow_109",
        sourceComponentId: "cmp_7",
        targetComponentId: "cmp_13",
        type: "api_call",
        confidence: 0.8,
        sourceLocation: {
          filePath: "src/email.ts",
          startLine: 12,
          endLine: 18,
        },
      },
    ],
  };
}

describe("discovery/exportScanDiscoveries", () => {
  it("emits ontology 0.2.0 scan Discoveries with separate entities", () => {
    const exportBundle = exportScanDiscoveries(
      {
        ...minimalScanResult(),
        filesScanned: 1,
        filesSkipped: 0,
        totalLines: 10,
        scanDurationMs: 1,
        warnings: [],
        errors: [],
      },
      { assertedAt: FIXED_ASSERTED_AT },
    );

    expect(scanDiscoveryExportSchema.parse(exportBundle)).toEqual(exportBundle);
    expect(exportBundle.ontology_version).toBe("0.2.0");
    expect(exportBundle.ontology_sha).toBe(
      "0656c5d9a6ce0d31440c63327ce597ce8df4414f",
    );
    expect(exportBundle.surface).toBe("a0-data-flow");

    expect(exportBundle.entities).toHaveLength(3);
    expect(exportBundle.discoveries.every((record) => record.source === "scan")).toBe(
      true,
    );
    expect(exportBundle.discoveries.some((record) => record.source !== "scan")).toBe(
      false,
    );

    const awsEntities = exportBundle.entities.filter((entity) => entity.name === "Aws");
    expect(awsEntities).toHaveLength(2);
    expect(new Set(awsEntities.map((entity) => entity.scanner_id))).toEqual(
      new Set(["cmp_3", "cmp_11"]),
    );

    const existence = exportBundle.discoveries.find(
      (record) => record.id === "dp:discovery/scan/cmp_3/existence",
    );
    expect(existence).toMatchObject({
      class: "Discovery",
      asserts: "dp:scan/entity/cmp_3",
      raw_evidence_ref: "scan:infra/main.tf:4-8",
    });
    expect(existence?.asserted_slot).toBeUndefined();

    const flow = exportBundle.entities.find((entity) => entity.scanner_id === "flow_109");
    expect(flow).toMatchObject({
      class: "SendsDataTo",
      source_component_id: "cmp_7",
      target_component_id: "cmp_13",
    });
  });

  it("never emits Finding class records or interview/cloud source", () => {
    const exportBundle = exportScanDiscoveries(
      {
        ...minimalScanResult(),
        filesScanned: 1,
        filesSkipped: 0,
        totalLines: 10,
        scanDurationMs: 1,
        warnings: [],
        errors: [],
      },
      { assertedAt: FIXED_ASSERTED_AT },
    );

    for (const record of exportBundle.discoveries) {
      expect(record.class).toBe("Discovery");
      expect(record.source).toBe("scan");
    }
    expect(JSON.stringify(exportBundle)).not.toMatch(/"Finding"/);
    expect(JSON.stringify(exportBundle)).not.toMatch(/"interview"/);
    expect(JSON.stringify(exportBundle)).not.toMatch(/"cloud"/);
  });

  it("matches committed entity fixture for duplicate ExternalSystem ids", () => {
    const exportBundle = exportScanDiscoveries(
      {
        ...minimalScanResult(),
        filesScanned: 1,
        filesSkipped: 0,
        totalLines: 10,
        scanDurationMs: 1,
        warnings: [],
        errors: [],
      },
      { assertedAt: FIXED_ASSERTED_AT },
    );

    const fixturePath = path.join(
      __dirname,
      "..",
      "..",
      "fixtures",
      "discovery-export",
      "minimal-mush-duplicate.json",
    );
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
      entities: Array<{ id: string; scanner_id: string; class: string; name: string }>;
    };

    expect(exportBundle.entities.map((entity) => entity.id)).toEqual(
      fixture.entities.map((entity) => entity.id),
    );
    expect(exportBundle.entities).toMatchObject(fixture.entities);
  });

  it("exports components and dataFlows from typescript-basic fixture scan", async () => {
    const fixturesRoot = path.join(__dirname, "..", "..", "fixtures", "typescript-basic");
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult } = await scan(fixturesRoot, config);

    const exportBundle = exportScanDiscoveries(scanResult, {
      assertedAt: FIXED_ASSERTED_AT,
    });

    expect(exportBundle.entities.length).toBe(
      scanResult.components.length + scanResult.dataFlows.length,
    );
    expect(exportBundle.discoveries.length).toBeGreaterThan(exportBundle.entities.length);
    expect(exportBundle.discoveries.every((record) => record.source === "scan")).toBe(
      true,
    );
  });
});
