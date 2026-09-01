import {
  buildMaterializationValidationReport,
  evaluateMaterializationEntry,
  isMaterializationValidationPassing,
} from "../../benchmark/materialization-validation";

describe("materialization validation report", () => {
  it("reports missing materializations for all corpus packets without local cache", () => {
    const report = buildMaterializationValidationReport();
    expect(report.totalPackets).toBe(29);
    expect(report.validCount).toBe(0);
    expect(report.failures).toHaveLength(29);
    expect(report.failures.every((failure) => failure.validationStatus === "missing")).toBe(
      true,
    );
    expect(isMaterializationValidationPassing(report)).toBe(false);
  });

  it("treats head mismatch as invalid even when status is valid", () => {
    const failure = evaluateMaterializationEntry({
      repoKey: "fixture-packet",
      manifestCommit: "b".repeat(40),
      validatedHeadSha: "a".repeat(40),
      validationStatus: "valid",
    });

    expect(failure).toMatchObject({
      repoKey: "fixture-packet",
      validationStatus: "invalid",
    });
    expect(failure?.reason).toMatch(/does not match manifest commit/);
  });

  it("accepts entries with matching manifest commit and validated head", () => {
    const commit = "a".repeat(40);
    expect(
      evaluateMaterializationEntry({
        repoKey: "fixture-packet",
        manifestCommit: commit,
        validatedHeadSha: commit,
        validationStatus: "valid",
      }),
    ).toBeNull();
  });
});
