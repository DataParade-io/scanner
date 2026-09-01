import fs from "node:fs";
import path from "node:path";

import {
  buildAcceptedGoldExpectation,
  buildScannerFinding,
  loadLegacyGoldRecord,
  observationsMatch,
  sampleEvidence,
  strictCorrectness,
  withId,
} from "../../eval/canonical";

const compatDir = path.join(__dirname, "../../eval/canonical/compat");
const evidence = sampleEvidence("src/app.ts", 5, 5);

describe("canonical evaluator isolation", () => {
  it("never leaves legacy prefixes on identity.identityKey", () => {
    const inputs = [
      {
        id: "iso-mention",
        layer: "mentions" as const,
        subject: { key: "mention:email" },
      },
      {
        id: "iso-pii-signal",
        layer: "mentions" as const,
        subject: { key: "pii_signal:email" },
      },
    ];

    for (const input of inputs) {
      const { record } = loadLegacyGoldRecord(
        {
          ...input,
          evidence,
          expected: { status: "positive", labels: [] },
          provenance: {
            proposed_by: "test",
            proposed_at: "2026-08-31",
            review_state: "accepted",
          },
        },
        { warn: () => undefined },
      );
      expect(record.identity.identityKey).not.toMatch(/^pii:/);
      expect(record.identity.identityKey).not.toMatch(/^pii_signal:/);
    }
  });

  it("maps mention:email to concept leaf email_address via rule_id_to_concept_leaf", () => {
    const { record } = loadLegacyGoldRecord(
      {
        id: "iso-rule-map",
        layer: "mentions",
        subject: { key: "mention:email" },
        evidence,
        expected: { status: "positive", labels: ["email"] },
        provenance: {
          proposed_by: "test",
          proposed_at: "2026-08-31",
          review_state: "accepted",
        },
      },
      { warn: () => undefined },
    );

    expect(record.identity.identityKey).toBe("mention:email");
    expect(record.classification.conceptLeaf).toBe("email_address");
    expect(record.classification.conceptLeaf).not.toBe("email");
  });

  it("treats matching observedTokenCandidates without identity match as a strict miss", () => {
    const expectation = withId(
      buildAcceptedGoldExpectation({
        layer: "mentions",
        identityKey: "mention:email",
        conceptLeaf: "email_address",
        evidenceLocations: [evidence],
        observedTokenCandidates: [
          {
            value: "shared",
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
        evidenceLocations: [evidence],
        observedTokenCandidates: [
          {
            value: "shared",
            evidenceRef: 0,
            provenance: "scanner",
            validationState: "verified",
          },
        ],
      }),
    );

    expect(strictCorrectness(expectation, finding)).toBe(false);
  });

  it("treats matching displayText without identity match as a non-match", () => {
    const expectation = withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::db-a",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [evidence],
        displayText: "Shared Label",
      }),
    );

    const finding = withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::db-b",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [evidence],
        displayText: "Shared Label",
      }),
    );

    expect(observationsMatch(expectation, finding)).toBe(false);
    expect(strictCorrectness(expectation, finding)).toBe(false);
  });

  it("keeps compat modules free of tests/eval/identity imports", () => {
    for (const file of fs.readdirSync(compatDir)) {
      if (!file.endsWith(".ts")) {
        continue;
      }
      const source = fs.readFileSync(path.join(compatDir, file), "utf8");
      expect(source).not.toMatch(/from\s+["'][^"']*\/identity["']/);
      expect(source).not.toContain("EQUIVALENCE_GROUPS");
      expect(source).not.toContain("PARENT_TO_CHILDREN");
    }
  });
});
