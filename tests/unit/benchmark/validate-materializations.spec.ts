import {
  buildMaterializationValidationReport,
  evaluateMaterializationEntry,
  isMaterializationValidationPassing,
} from "../../benchmark/materialization-validation";

describe("materialization validation report", () => {
  it("reports materialization status for the corpus benchmark root", () => {
    const report = buildMaterializationValidationReport();
    expect(report.totalPackets).toBe(29);
    if (report.validCount === 0) {
      expect(report.failures).toHaveLength(29);
      expect(report.failures.every((failure) => failure.validationStatus === "missing")).toBe(
        true,
      );
      expect(isMaterializationValidationPassing(report)).toBe(false);
      return;
    }

    expect(report.failures).toHaveLength(0);
    expect(isMaterializationValidationPassing(report)).toBe(true);
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
