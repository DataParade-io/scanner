import {
  assignOneToOne,
  buildAcceptedGoldExpectation,
  buildMigrationIncompleteRecord,
  buildScannerFinding,
  computeBaselineMetrics,
  computeCapabilityCoverage,
  computeStrictRecall,
  computeVendorResolution,
  declaredCapabilityUnsupported,
  oneFindingCannotSatisfyBoth,
  sampleEvidence,
  withId,
} from "../../eval/canonical";

const evidenceA = [sampleEvidence("src/db-primary.ts", 1, 1)];
const evidenceB = [sampleEvidence("src/db-replica.ts", 2, 2)];

describe("canonical assignment", () => {
  it("prevents one finding from satisfying two same-subtype expectations", () => {
    const expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "components",
          identityKey: "repo::db-primary",
          conceptLeaf: "database",
          componentType: "asset",
          componentSubtype: "database",
          evidenceLocations: evidenceA,
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
          evidenceLocations: evidenceB,
        }),
        "exp-b",
      ),
    ];
    const finding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::db-primary",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidenceA,
      }),
      "find-1",
    );
    expect(oneFindingCannotSatisfyBoth(expectations, finding)).toBe(true);
  });

  it("does not guess between indistinguishable same-subtype expectations", () => {
    const sharedEvidence = [sampleEvidence("src/shared.ts", 5, 5)];
    const expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "components",
          identityKey: "repo::shared-db",
          conceptLeaf: "database",
          componentType: "asset",
          componentSubtype: "database",
          evidenceLocations: sharedEvidence,
          entityId: "gold-entity-a",
        }),
        "exp-1",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "components",
          identityKey: "repo::shared-db",
          conceptLeaf: "database",
          componentType: "asset",
          componentSubtype: "database",
          evidenceLocations: sharedEvidence,
          entityId: "gold-entity-b",
        }),
        "exp-2",
      ),
    ];
    const finding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::shared-db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: sharedEvidence,
      }),
      "find-1",
    );
    const result = assignOneToOne(expectations, [finding]);
    expect(result.ambiguous).toBe(true);
    expect(result.pairs).toHaveLength(0);
  });
});

describe("canonical metrics", () => {
  const vendorExpectation = withId(
    buildAcceptedGoldExpectation({
      layer: "components",
      identityKey: "repo::stripe",
      conceptLeaf: "payment_processor",
      componentType: "third_party",
      componentSubtype: "saas_service",
      optionalAssertion: { vendor: "stripe" },
      evidenceLocations: evidenceA,
    }),
    "vendor-exp",
  );
  const subtypeOnlyExpectation = withId(
    buildAcceptedGoldExpectation({
      layer: "components",
      identityKey: "repo::db",
      conceptLeaf: "database",
      componentType: "asset",
      componentSubtype: "database",
      evidenceLocations: evidenceB,
    }),
    "subtype-exp",
  );

  it("uses vendor-asserting denominator for vendor-resolution metrics", () => {
    const metrics = computeVendorResolution(
      [vendorExpectation, subtypeOnlyExpectation],
      [],
    );
    expect(metrics.denominator).toBe(1);
  });

  it("counts unsupported capability as strict false negative", () => {
    const unsupported = withId(
      buildAcceptedGoldExpectation({
        layer: "mentions",
        identityKey: "mention:rare",
        conceptLeaf: "rare_concept",
        evidenceLocations: evidenceA,
        declaredCapabilitySupported: {
          supported: false,
          reason: "detector not declared",
        },
      }),
      "unsupported",
    );
    const recall = computeStrictRecall([unsupported], []);
    expect(recall.falseNegatives).toBe(1);
    expect(declaredCapabilityUnsupported(unsupported).supported).toBe(false);
    expect(declaredCapabilityUnsupported(unsupported).reason).toBeTruthy();
  });

  it("keeps capability coverage separate from recall denominator", () => {
    const supported = withId(
      buildAcceptedGoldExpectation({
        layer: "mentions",
        identityKey: "mention:email",
        conceptLeaf: "email_address",
        evidenceLocations: evidenceA,
        declaredCapabilitySupported: { supported: true },
      }),
      "supported",
    );
    const unsupported = withId(
      buildAcceptedGoldExpectation({
        layer: "mentions",
        identityKey: "mention:rare",
        conceptLeaf: "rare_concept",
        evidenceLocations: evidenceB,
        declaredCapabilitySupported: {
          supported: false,
          reason: "missing detector",
        },
      }),
      "unsupported",
    );
    const result = computeCapabilityCoverage([supported, unsupported], []);
    expect(result.recall.denominator).toBe(2);
    expect(result.recall.falseNegatives).toBe(2);
    expect(result.capabilityCoverage.caseWeighted).toBe(0.5);
  });

  it("excludes migration-incomplete records from baseline false negatives", () => {
    const accepted = withId(
      buildAcceptedGoldExpectation({
        layer: "mentions",
        identityKey: "mention:email",
        conceptLeaf: "email_address",
        evidenceLocations: evidenceA,
      }),
      "accepted",
    );
    const incomplete = withId(
      buildMigrationIncompleteRecord({
        layer: "data-items",
        identityKey: "source-field:clientId",
        evidenceLocations: evidenceB,
      }),
      "incomplete",
    );
    const baseline = computeBaselineMetrics([accepted, incomplete], []);
    expect(baseline.migrationIncompleteCount).toBe(1);
    expect(baseline.strictRecall.denominator).toBe(1);
    expect(baseline.baselineFalseNegativeCount).toBe(1);
  });
});
