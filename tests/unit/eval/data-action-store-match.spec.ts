import { dataActionEvalCases } from "../../eval/layers/data-actions/cases";
import { scanFixtureDataActionAssignments } from "../../eval/layers/data-actions/adapter";
import { loadCanonicalGoldFromEvalCase } from "../../eval/canonical/gold/loader";
import { scoreEvalCases } from "../../eval/score";
import { findingsForEvalLayer } from "../../eval/canonical/bridge";

describe("data-action store subtype identity", () => {
  it("matches ts-pg-store to asset:database store finding", async () => {
    const caseRecord = dataActionEvalCases.find((entry) => entry.id === "ts-pg-store");
    expect(caseRecord).toBeDefined();

    const { record: gold } = loadCanonicalGoldFromEvalCase(caseRecord!);
    expect(gold.identity.identityKey).toBe("asset:database");

    const { scanResult } = await scanFixtureDataActionAssignments("typescript-basic");
    const findings = findingsForEvalLayer(
      scanResult.findings,
      "data-actions",
      "typescript-basic::data-actions",
    );
    const storeFindings = findings.filter((finding) => finding.classification.conceptLeaf === "store");
    const databaseStore = storeFindings.find(
      (finding) => finding.identity.identityKey === "asset:database",
    );
    expect(databaseStore).toBeDefined();
    expect(databaseStore!.evidenceLocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file_path: "db-client-import.ts",
          start_line: 1,
          end_line: 1,
        }),
      ]),
    );
    expect(gold.evidenceLocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file_path: "db-client-import.ts",
          start_line: 1,
          end_line: 1,
        }),
      ]),
    );

    const report = scoreEvalCases([caseRecord!], [scanResult]);
    expect(report.caseResults[0]?.matched).toBe(true);
    expect(report.caseResults[0]?.unread).toBe(false);
  });
});
