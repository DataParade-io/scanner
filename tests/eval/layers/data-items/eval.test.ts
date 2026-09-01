import { dataItemEvalCases } from "./cases";
import { scanFixtureDataItems } from "./adapter";
import { scoreEvalCases } from "../../score";

describe("eval/layers/data-items", () => {
  const fixtures = [...new Set(dataItemEvalCases.map((caseRecord) => caseRecord.fixture))];

  it("meets data-item layer ground-truth expectations", async () => {
    const scanResults = await Promise.all(fixtures.map(scanFixtureDataItems));
    const report = scoreEvalCases(dataItemEvalCases, scanResults);

    const failingNegatives = report.caseResults.filter((result) => {
      const caseRecord = dataItemEvalCases.find((entry) => entry.id === result.caseId)!;
      return caseRecord.expected.status === "negative" && !result.unread && !result.negativeClean;
    });
    expect(failingNegatives).toEqual([]);

    expect(report.scores.unreadCount).toBe(0);
    expect(report.scores.negativeCasePassRate).toBe(1);
    expect(report.scores.recall).toBeCloseTo(5 / 6, 5);
    expect(report.scores.precision).toBe(1);
    expect(report.scores.denominators.exhaustiveScopedFindings).toBeGreaterThan(0);

    const identityOnly = report.caseResults.find(
      (result) => result.caseId === "data-item-jvm-username-identity-only",
    );
    expect(identityOnly?.matched).toBe(false);

    const multiFile = report.caseResults.find(
      (result) => result.caseId === "data-item-jvm-username-multi-file",
    );
    expect(multiFile?.matched).toBe(true);

    const jvmScan = scanResults.find((result) => result.fixture === "jvm-manifests-basic");
    expect(jvmScan).toBeDefined();
    const usernameFindings = jvmScan!.findings.filter(
      (finding) => finding.key === "data_item:username",
    );
    expect(usernameFindings).toHaveLength(1);
    expect(usernameFindings[0]?.sourceLines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file_path: "src/main/resources/application.yml",
          start_line: 6,
          end_line: 6,
        }),
        expect.objectContaining({
          file_path: "src/main/resources/bootstrap.yml",
          start_line: 6,
          end_line: 6,
        }),
      ]),
    );
  });
});
