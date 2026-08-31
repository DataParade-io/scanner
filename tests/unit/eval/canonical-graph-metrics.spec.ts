import {
  buildAcceptedGoldExpectation,
  buildScannerFinding,
  computeEvidenceCoverage,
  computeGraphStageMetrics,
  computeGraphVendorResolution,
  graphStrictCorrectness,
  sampleEvidence,
  withId,
} from "../../eval/canonical";

const evidenceA = [sampleEvidence("src/stripe.ts", 1, 1)];
const evidenceB = [sampleEvidence("src/db.ts", 2, 2)];

describe("graph metrics", () => {
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

  it("uses vendor-asserting denominator for graph vendor metrics", () => {
    const metrics = computeGraphVendorResolution(
      [vendorExpectation, subtypeOnlyExpectation],
      [],
    );
    expect(metrics.denominator).toBe(1);
  });

  it("keeps graph stage metrics diagnostic without inflating strict recall", () => {
    const finding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::stripe",
        conceptLeaf: "national_identifier",
        componentType: "third_party",
        componentSubtype: "saas_service",
        optionalAssertion: { vendor: "stripe" },
        evidenceLocations: evidenceA,
      }),
      "ancestor-find",
    );
    const stages = computeGraphStageMetrics([vendorExpectation], [finding]);
    const semantic = stages.find((stage) => stage.stage === "semantic_classification");
    expect(semantic?.passed).toBe(0);
    expect(graphStrictCorrectness(vendorExpectation, finding)).toBe(false);
  });

  it("scores consolidated entity recall once with separate evidence coverage", () => {
    const consolidatedExpectation = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [
          sampleEvidence("src/db.ts", 1, 1),
          sampleEvidence("src/db.ts", 2, 2),
        ],
      }),
      "consolidated",
    );
    const finding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/db.ts", 1, 1)],
      }),
      "find",
    );
    const coverage = computeEvidenceCoverage([consolidatedExpectation], [finding]);
    expect(coverage.entityRecallDenominator).toBe(1);
    expect(coverage.entityRecallMatched).toBe(1);
    expect(coverage.evidenceLocationCount).toBe(2);
    expect(coverage.evidenceLocationsCovered).toBe(2);
  });
});
