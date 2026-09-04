import {
  buildAcceptedGoldExpectation,
  consolidateComponentRows,
  oneFindingCannotSatisfyBoth,
  sampleEvidence,
  withId,
} from "../../eval/canonical";

describe("consolidateComponentRows", () => {
  it("merges rows sharing reviewed entityId before assignment", () => {
    const evidenceA = [sampleEvidence("src/db.ts", 1, 1)];
    const evidenceB = [sampleEvidence("src/db.ts", 2, 2)];
    const rowA = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::primary-db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidenceA,
        entityId: "gold-entity-1",
      }),
      "row-a",
    );
    const rowB = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::primary-db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidenceB,
        entityId: "gold-entity-1",
      }),
      "row-b",
    );

    const result = consolidateComponentRows([
      { id: rowA.id, record: rowA },
      { id: rowB.id, record: rowB },
    ]);

    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].sourceRowIds).toEqual(["row-a", "row-b"]);
    expect(result.entities[0].evidenceLocations).toHaveLength(2);
    expect(result.adjudication).toHaveLength(0);
  });

  it("keeps distinct same-subtype entities separate", () => {
    const rowA = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::db-primary",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/primary.ts", 1, 1)],
      }),
      "primary",
    );
    const rowB = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::db-replica",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/replica.ts", 2, 2)],
      }),
      "replica",
    );

    const result = consolidateComponentRows([
      { id: rowA.id, record: rowA },
      { id: rowB.id, record: rowB },
    ]);

    expect(result.entities).toHaveLength(2);
    expect(result.adjudication).toHaveLength(0);
  });

  it("marks ambiguous same-subtype grouping as needs_adjudication", () => {
    const evidenceA = [sampleEvidence("src/shared.ts", 5, 5)];
    const evidenceB = [sampleEvidence("src/other.ts", 9, 9)];
    const rowA = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::shared-db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidenceA,
        entityId: "gold-entity-a",
      }),
      "ambig-a",
    );
    const rowB = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::shared-db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidenceB,
        entityId: "gold-entity-b",
      }),
      "ambig-b",
    );

    const result = consolidateComponentRows([
      { id: rowA.id, record: rowA },
      { id: rowB.id, record: rowB },
    ]);

    expect(result.entities).toHaveLength(0);
    expect(result.adjudication).toHaveLength(1);
    expect(result.adjudication[0].disposition).toBe("needs_adjudication");
  });

  it("does not invent optionalAssertion.instance for grouping", () => {
    const row = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/db.ts", 1, 1)],
      }),
      "row-only",
    );
    const result = consolidateComponentRows([{ id: row.id, record: row }]);
    expect(result.entities[0].optionalAssertion?.instance).toBeUndefined();
  });
});

describe("post-consolidation cardinality", () => {
  it("prevents one finding from satisfying two distinct consolidated entities", () => {
    const expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "components",
          identityKey: "repo::db-primary",
          conceptLeaf: "database",
          componentType: "asset",
          componentSubtype: "database",
          evidenceLocations: [sampleEvidence("src/primary.ts", 1, 1)],
        }),
        "exp-a",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "components",
          identityKey: "repo::db-replica",
          conceptLeaf: "database",
          componentType: "asset",
          componentSubtype: "database",
          evidenceLocations: [sampleEvidence("src/replica.ts", 2, 2)],
        }),
        "exp-b",
      ),
    ];
    const finding = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::db-primary",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/primary.ts", 1, 1)],
      }),
      "find-1",
    );
    expect(oneFindingCannotSatisfyBoth(expectations, finding)).toBe(true);
  });
});
