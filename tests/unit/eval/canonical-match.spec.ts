import {
  buildAcceptedGoldExpectation,
  buildScannerFinding,
  conceptCorrectness,
  contractVersionsMatch,
  observationsMatch,
  sampleEvidence,
  stampEnvelope,
  strictCorrectness,
  withId,
} from "../../eval/canonical";

const evidence = [sampleEvidence("src/app.ts", 5, 5)];

describe("canonical strict matching", () => {
  it("treats identity mismatch with matching display name as a strict miss", () => {
    const expectation = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::db-a",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidence,
        displayText: "Primary DB",
      }),
    );
    const finding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::db-b",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidence,
        displayText: "Primary DB",
      }),
    );
    expect(strictCorrectness(expectation, finding)).toBe(false);
    expect(observationsMatch(expectation, finding)).toBe(false);
  });

  it("treats identity mismatch with matching observed-token candidate as a strict miss", () => {
    const expectation = withId(
      buildAcceptedGoldExpectation({
        layer: "mentions",
        identityKey: "mention:email",
        conceptLeaf: "email_address",
        evidenceLocations: evidence,
        observedTokenCandidates: [
          {
            value: "userEmail",
            evidenceRef: 0,
            provenance: "legacy-subject-name",
            validationState: "verified",
          },
        ],
      }),
    );
    const finding = withId(
      buildScannerFinding({
        layer: "mentions",
        identityKey: "mention:phone",
        conceptLeaf: "phone_number",
        evidenceLocations: evidence,
        observedTokenCandidates: [
          {
            value: "userEmail",
            evidenceRef: 0,
            provenance: "scanner",
            validationState: "verified",
          },
        ],
      }),
    );
    expect(strictCorrectness(expectation, finding)).toBe(false);
  });

  it("succeeds when asserted fields and evidence match without display", () => {
    const expectation = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::api",
        conceptLeaf: "api_surface",
        componentType: "asset",
        componentSubtype: "api",
        evidenceLocations: evidence,
        displayText: "Legacy API Name",
      }),
    );
    const finding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::api",
        conceptLeaf: "api_surface",
        componentType: "asset",
        componentSubtype: "api",
        evidenceLocations: evidence,
      }),
    );
    expect(strictCorrectness(expectation, finding)).toBe(true);
  });

  it("requires asserted vendor for third-party strict match", () => {
    const expectation = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::stripe",
        conceptLeaf: "payment_processor",
        componentType: "third_party",
        componentSubtype: "saas_service",
        optionalAssertion: { vendor: "stripe" },
        evidenceLocations: evidence,
      }),
    );
    const finding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::stripe",
        conceptLeaf: "payment_processor",
        componentType: "third_party",
        componentSubtype: "saas_service",
        optionalAssertion: { vendor: "checkr" },
        evidenceLocations: evidence,
      }),
    );
    expect(strictCorrectness(expectation, finding)).toBe(false);
  });

  it("rejects mismatched contractVersion", () => {
    const expectation = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidence,
        adapterMapVersion: "gold-digest",
      }),
    );
    const finding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidence,
        adapterMapVersion: "scanner-digest",
      }),
    );
    expect(contractVersionsMatch(expectation, finding)).toBe(true);
    expect(strictCorrectness(expectation, finding)).toBe(true);
  });
});

describe("canonical concept correctness", () => {
  it("does not credit exact-leaf when only ancestor matches", () => {
    const expectation = withId(
      buildAcceptedGoldExpectation({
        layer: "mentions",
        identityKey: "mention:driver-licence",
        conceptLeaf: "driver_licence",
        conceptAncestry: ["national_identifier", "driver_licence"],
        evidenceLocations: evidence,
      }),
    );
    const finding = withId(
      buildScannerFinding({
        layer: "mentions",
        identityKey: "mention:driver-licence",
        conceptLeaf: "national_identifier",
        conceptAncestry: ["national_identifier"],
        evidenceLocations: evidence,
      }),
    );
    const correctness = conceptCorrectness(expectation, finding);
    expect(correctness.exactLeaf).toBe(false);
    expect(correctness.ancestorCategory).toBe(true);
    expect(strictCorrectness(expectation, finding)).toBe(false);
  });
});
