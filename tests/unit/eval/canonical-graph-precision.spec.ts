import {
  buildAcceptedGoldExpectation,
  buildScannerFinding,
  computeGraphPrecision,
  sampleEvidence,
  withId,
} from "../../eval/canonical";

describe("computeGraphPrecision", () => {
  const scopeFiles = ["src/app.ts"];

  it("scores scoped findings in the closed-world denominator", () => {
    const positive = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::pg",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/app.ts", 1, 1)],
      }),
      "positive",
    );
    const matchedFinding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::pg",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/app.ts", 1, 1)],
      }),
      "matched",
    );
    const extraFinding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::extra",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/app.ts", 2, 2)],
      }),
      "extra",
    );

    const report = computeGraphPrecision(
      [matchedFinding, extraFinding],
      [positive],
      new Map([
        [
          "components",
          {
            exhaustiveScopeFiles: scopeFiles,
            reviewState: "accepted",
          },
        ],
      ]),
    );

    expect(report.denominator).toBe(2);
    expect(report.matches).toBe(1);
    expect(report.precision).toBe(0.5);
  });

  it("keeps locationless findings visible with computability reason outside denominator", () => {
    const positive = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::pg",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/app.ts", 1, 1)],
      }),
      "positive",
    );
    const locatedFinding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::pg",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/app.ts", 1, 1)],
      }),
      "located",
    );
    const locationlessFinding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "actor:user",
        conceptLeaf: "customer",
        componentType: "actor",
        componentSubtype: "customer",
        evidenceLocations: [],
      }),
      "locationless",
    );

    const report = computeGraphPrecision(
      [locatedFinding, locationlessFinding],
      [positive],
      new Map([
        [
          "components",
          {
            exhaustiveScopeFiles: scopeFiles,
            reviewState: "accepted",
          },
        ],
      ]),
    );

    expect(report.denominator).toBe(1);
    expect(report.precision).toBe(1);
    expect(report.locationlessVisible).toEqual([
      { findingId: "locationless", reason: "locationless_finding" },
    ]);
    const locationlessItem = report.items.find((item) => item.findingId === "locationless");
    expect(locationlessItem?.inDenominator).toBe(false);
    expect(locationlessItem?.computabilityReason).toBe("locationless_finding");
  });

  it("returns null precision when no exhaustive scope is declared", () => {
    const report = computeGraphPrecision([], [], new Map());
    expect(report.precision).toBeNull();
    expect(report.computabilityReason).toBe("no_exhaustive_scope");
  });

  it("marks processed scope with zero predictions separately from missing scope", () => {
    const positive = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::pg",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/app.ts", 1, 1)],
      }),
      "positive",
    );

    const report = computeGraphPrecision(
      [],
      [positive],
      new Map([
        [
          "components",
          {
            exhaustiveScopeFiles: scopeFiles,
            reviewState: "accepted",
          },
        ],
      ]),
    );

    expect(report.precision).toBeNull();
    expect(report.denominator).toBe(0);
    expect(report.computabilityReason).toBe("processed_scope_zero_predictions");
  });
});
