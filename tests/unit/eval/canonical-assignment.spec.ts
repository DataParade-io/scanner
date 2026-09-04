import {
  assignOneToOne,
  buildAcceptedGoldExpectation,
  buildScannerFinding,
  sampleEvidence,
  withId,
} from "../../eval/canonical";

describe("assignOneToOne scoped collision handling", () => {
  it("drops all pairs for a rolled-up data-item finding that matches multiple same-key gold rows", () => {
    const expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-items",
          identityKey: "data_item:username",
          conceptLeaf: "username",
          evidenceLocations: [sampleEvidence("src/a.yml", 1, 1)],
        }),
        "gold-username-a",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-items",
          identityKey: "data_item:username",
          conceptLeaf: "username",
          evidenceLocations: [sampleEvidence("src/b.yml", 2, 2)],
        }),
        "gold-username-b",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "data-items",
          identityKey: "data_item:password",
          conceptLeaf: "password",
          evidenceLocations: [sampleEvidence("src/a.yml", 3, 3)],
        }),
        "gold-password",
      ),
    ];

    const usernameFinding = withId(
      buildScannerFinding({
        layer: "data-items",
        identityKey: "data_item:username",
        conceptLeaf: "username",
        evidenceLocations: [
          sampleEvidence("src/a.yml", 1, 1),
          sampleEvidence("src/b.yml", 2, 2),
        ],
      }),
      "finding-username",
    );
    const passwordFinding = withId(
      buildScannerFinding({
        layer: "data-items",
        identityKey: "data_item:password",
        conceptLeaf: "password",
        evidenceLocations: [sampleEvidence("src/a.yml", 3, 3)],
      }),
      "finding-password",
    );

    const result = assignOneToOne(expectations, [usernameFinding, passwordFinding]);

    expect(result.ambiguous).toBe(true);
    expect(
      result.pairs.filter((pair) => pair.findingId === "finding-username"),
    ).toEqual([]);
    expect(result.pairs).toEqual([
      { expectationId: "gold-password", findingId: "finding-password" },
    ]);
    expect(result.unmatchedExpectationIds).toEqual(
      expect.arrayContaining(["gold-username-a", "gold-username-b"]),
    );
    expect(result.unmatchedFindingIds).toContain("finding-username");
  });
});
