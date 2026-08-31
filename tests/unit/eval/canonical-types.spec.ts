import {
  buildAcceptedGoldExpectation,
  buildMigrationIncompleteRecord,
  buildNeedsAdjudicationRecord,
  buildScannerFinding,
  CANONICAL_CONTRACT_VERSION,
  isAcceptedEvaluablePositive,
  sampleEvidence,
  scannerFindingHasEntityId,
  stampEnvelope,
} from "../../eval/canonical";

describe("canonical contract envelope", () => {
  it("stamps contractVersion on every envelope", () => {
    const envelope = stampEnvelope("digest-abc");
    expect(envelope.contractVersion).toBe(CANONICAL_CONTRACT_VERSION);
    expect(envelope.adapterMapVersion).toBe("digest-abc");
  });
});

describe("canonical gold vs scanner types", () => {
  it("allows entityId on gold expectations only", () => {
    const gold = buildAcceptedGoldExpectation({
      layer: "components",
      identityKey: "repo::db-primary",
      conceptLeaf: "database",
      componentType: "asset",
      componentSubtype: "database",
      evidenceLocations: [sampleEvidence()],
      entityId: "gold-entity-1",
    });
    expect(gold.entityId).toBe("gold-entity-1");
  });

  it("does not allow entityId on scanner findings", () => {
    const finding = buildScannerFinding({
      layer: "components",
      identityKey: "repo::db-primary",
      conceptLeaf: "database",
      componentType: "asset",
      componentSubtype: "database",
      evidenceLocations: [sampleEvidence()],
    });
    expect(scannerFindingHasEntityId(finding)).toBe(false);
    expect("entityId" in finding).toBe(false);
  });
});

describe("canonical disposition guards", () => {
  it("rejects building accepted without concept leaf", () => {
    expect(() =>
      buildAcceptedGoldExpectation({
        layer: "data-items",
        identityKey: "item-1",
        conceptLeaf: "",
        evidenceLocations: [sampleEvidence()],
      }),
    ).toThrow(/concept leaf/i);
  });

  it("cannot construct accepted source-token-only records", () => {
    const incomplete = buildMigrationIncompleteRecord({
      layer: "data-items",
      identityKey: "source-field-only",
      evidenceLocations: [sampleEvidence()],
    });
    expect(incomplete.disposition).toBe("migration_incomplete");
    expect(isAcceptedEvaluablePositive(incomplete)).toBe(false);
  });

  it("routes unresolved flow disposition to needs_adjudication", () => {
    const record = buildNeedsAdjudicationRecord({
      layer: "data-flows",
      identityKey: "flow:legacy",
      conceptLeaf: "data_transfer",
      evidenceLocations: [sampleEvidence()],
    });
    expect(record.disposition).toBe("needs_adjudication");
    expect(isAcceptedEvaluablePositive(record)).toBe(false);
  });
});
