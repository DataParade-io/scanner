import { scanResultSchema } from "../../../src/core/schema/scan-result.schema";

describe("scanResultSchema data flow sourceLocations", () => {
  it("preserves sourceLocations on data flows through parse", () => {
    const parsed = scanResultSchema.parse({
      components: [],
      dataFlows: [
        {
          id: "flow_1",
          sourceComponentId: "cmp_a",
          targetComponentId: "cmp_b",
          type: "api_call",
          confidence: 0.9,
          sourceLocation: {
            filePath: "src/a.ts",
            startLine: 1,
            endLine: 1,
          },
          sourceLocations: [
            { filePath: "src/a.ts", startLine: 1, endLine: 1 },
            { filePath: "src/b.ts", startLine: 2, endLine: 2 },
          ],
        },
      ],
      filesScanned: 0,
      filesSkipped: 0,
      totalLines: 0,
      scanDurationMs: 0,
      warnings: [],
      errors: [],
    });

    expect(parsed.dataFlows[0]?.sourceLocations).toEqual([
      { filePath: "src/a.ts", startLine: 1, endLine: 1 },
      { filePath: "src/b.ts", startLine: 2, endLine: 2 },
    ]);
  });
});
