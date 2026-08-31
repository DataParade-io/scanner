import fs from "node:fs";
import path from "node:path";

import {
  CANONICAL_CONTRACT_VERSION,
  CONVERSION_KINDS,
  LEGACY_SOURCE_CONTRACT_VERSION,
  annotationRecordToLegacyInput,
  buildScannerFinding,
  isAcceptedEvaluablePositive,
  loadLegacyGoldRecord,
  observationsMatch,
  sampleEvidence,
  strictCorrectness,
  withId,
} from "../../eval/canonical";
import type { LegacyGoldRecord } from "../../eval/canonical";
import type { AnnotationRecord } from "../../benchmark/schema";

const evidence = sampleEvidence("src/User.ts", 10, 11);

function legacyRecord(overrides: Partial<LegacyGoldRecord> & Pick<LegacyGoldRecord, "id">): LegacyGoldRecord {
  return {
    layer: "mentions",
    subject: { key: "pii:email_address" },
    evidence,
    expected: { status: "positive", labels: ["email"] },
    provenance: {
      proposed_by: "test",
      proposed_at: "2026-08-31",
      review_state: "accepted",
    },
    ...overrides,
  };
}

describe("loadLegacyGoldRecord", () => {
  it("maps data_flows corpus layer to kebab-case canonical layer", () => {
    const { record, diagnostics } = loadLegacyGoldRecord(
      legacyRecord({
        id: "flow-row",
        layer: "data_flows",
        subject: { key: "flow:asset:api->third_party:stripe" },
        expected: { status: "positive", labels: [] },
      }),
      { warn: () => undefined },
    );

    expect(record.identity.layer).toBe("data-flows");
    expect(record.identity.layer).not.toBe("data_flows");
    expect(diagnostics.some((d) => d.conversion === "corpus_layer_to_canonical")).toBe(true);
    expect(diagnostics.find((d) => d.conversion === "corpus_layer_to_canonical")?.detail).toBe(
      "data_flows → data-flows",
    );
  });

  it("maps pii_signals through a single corpus_layer_to_canonical step", () => {
    const { diagnostics } = loadLegacyGoldRecord(
      legacyRecord({ id: "pii-signals-row", layer: "pii_signals" }),
      { warn: () => undefined },
    );

    const layerDiagnostics = diagnostics.filter((d) => d.conversion === "corpus_layer_to_canonical");
    expect(layerDiagnostics).toHaveLength(1);
    expect(layerDiagnostics[0]?.detail).toBe("pii_signals → mentions");
  });

  it("accepts pii: mention keys through the exemption conversion", () => {
    const { record } = loadLegacyGoldRecord(legacyRecord({ id: "pii-exempt" }), {
      warn: () => undefined,
    });

    expect(record.identity.identityKey).toBe("mention:email_address");
    expect(record.classification.conceptLeaf).toBe("email_address");
    expect(record.observedTokenCandidates?.some((t) => t.value === "pii:email_address")).toBe(true);
  });

  it("maps mention rule-id suffixes through rule_id_to_concept_leaf", () => {
    const { record, diagnostics } = loadLegacyGoldRecord(
      legacyRecord({
        id: "mention-rule-id",
        subject: { key: "mention:email" },
        expected: { status: "positive", labels: [] },
      }),
      { warn: () => undefined },
    );

    expect(record.classification.conceptLeaf).toBe("email_address");
    expect(record.classification.conceptAncestry).toEqual(["email_address"]);
    expect(diagnostics.some((entry) => entry.conversion === "rule_id_to_concept_leaf")).toBe(true);
  });

  it("does not remap pii: taxonomy keys through rule_id_to_concept_leaf", () => {
    const { record, diagnostics } = loadLegacyGoldRecord(legacyRecord({ id: "pii-no-rule-map" }), {
      warn: () => undefined,
    });

    expect(record.classification.conceptLeaf).toBe("email_address");
    expect(diagnostics.some((entry) => entry.conversion === "rule_id_to_concept_leaf")).toBe(false);
  });

  it("does not alias pii:email_address to mention:email or leaf email", () => {
    const { record } = loadLegacyGoldRecord(
      legacyRecord({
        id: "no-alias",
        subject: { key: "pii:email_address" },
        expected: { status: "positive", labels: ["email"] },
      }),
      { warn: () => undefined },
    );

    expect(record.identity.identityKey).not.toBe("mention:email");
    expect(record.classification.conceptLeaf).not.toBe("email");
    expect(record.identity.identityKey).toBe("mention:email_address");
    expect(record.classification.conceptLeaf).toBe("email_address");
  });

  it("rewrites stale pii_signal: prefix before identity assignment", () => {
    const { record, diagnostics } = loadLegacyGoldRecord(
      legacyRecord({
        id: "pii-signal-rewrite",
        subject: { key: "pii_signal:email" },
        expected: { status: "positive", labels: [] },
      }),
      { warn: () => undefined },
    );

    expect(diagnostics.some((d) => d.conversion === "pii_signal_prefix_rewrite")).toBe(true);
    expect(record.identity.identityKey).toBe("mention:email");
    expect(record.classification.conceptLeaf).toBe("email_address");
    expect(diagnostics.some((d) => d.conversion === "rule_id_to_concept_leaf")).toBe(true);
  });

  it("parks expected.labels as observed-token provenance without aliasing concept leaf", () => {
    const { record, diagnostics } = loadLegacyGoldRecord(
      legacyRecord({
        id: "labels-parked",
        subject: { key: "pii:email_address" },
        expected: { status: "positive", labels: ["email", "user_email"] },
      }),
      { warn: () => undefined },
    );

    expect(diagnostics.some((d) => d.conversion === "expected_labels_provenance")).toBe(true);
    expect(record.classification.conceptLeaf).toBe("email_address");
    expect(record.observedTokenCandidates?.map((t) => t.value)).toEqual(
      expect.arrayContaining(["pii:email_address", "email", "user_email"]),
    );
    expect(record.observedTokenCandidates?.find((t) => t.value === "email")?.provenance).toBe(
      "legacy-expected-label",
    );
  });

  it("maps subject.name to evidence-linked observed tokens only", () => {
    const { record } = loadLegacyGoldRecord(
      legacyRecord({
        id: "subject-name",
        subject: { key: "pii:user_identifier", name: "username" },
        expected: { status: "positive", labels: [] },
      }),
      { warn: () => undefined },
    );

    expect(record.optionalAssertion?.instance).toBeUndefined();
    expect(record.observedTokenCandidates?.some((t) => t.value === "username")).toBe(true);
    expect(
      record.observedTokenCandidates?.find((t) => t.value === "username")?.provenance,
    ).toBe("legacy-subject-name");
  });

  it("never yields accepted evaluable gold for ambiguous expected.status", () => {
    const { record } = loadLegacyGoldRecord(
      legacyRecord({
        id: "ambiguous-status",
        expected: { status: "ambiguous", labels: [] },
      }),
      { warn: () => undefined },
    );

    expect(record.disposition).not.toBe("accepted");
    expect(isAcceptedEvaluablePositive(record)).toBe(false);
  });

  it("routes accepted data-flow rows to needs_adjudication", () => {
    const { record } = loadLegacyGoldRecord(
      legacyRecord({
        id: "accepted-flow",
        layer: "data_flows",
        subject: { key: "flow:asset:api->third_party:stripe", name: "API to Stripe" },
        expected: { status: "positive", labels: ["data_flow"] },
      }),
      { warn: () => undefined },
    );

    expect(record.disposition).toBe("needs_adjudication");
    expect(isAcceptedEvaluablePositive(record)).toBe(false);
  });

  it("maps negative expected.status with rejected review to rejected disposition", () => {
    const { record } = loadLegacyGoldRecord(
      legacyRecord({
        id: "negative-rejected",
        expected: { status: "negative", labels: [] },
        provenance: {
          proposed_by: "test",
          proposed_at: "2026-08-31",
          review_state: "rejected",
        },
      }),
      { warn: () => undefined },
    );

    expect(record.disposition).toBe("rejected");
    expect(isAcceptedEvaluablePositive(record)).toBe(false);
  });

  it("maps negative expected.status with accepted review to needs_adjudication", () => {
    const { record } = loadLegacyGoldRecord(
      legacyRecord({
        id: "negative-accepted-review",
        expected: { status: "negative", labels: [] },
        provenance: {
          proposed_by: "test",
          proposed_at: "2026-08-31",
          review_state: "accepted",
        },
      }),
      { warn: () => undefined },
    );

    expect(record.disposition).toBe("needs_adjudication");
    expect(isAcceptedEvaluablePositive(record)).toBe(false);
  });

  it("maps positive expected.status with proposed review to needs_adjudication", () => {
    const { record } = loadLegacyGoldRecord(
      legacyRecord({
        id: "positive-proposed",
        expected: { status: "positive", labels: [] },
        provenance: {
          proposed_by: "test",
          proposed_at: "2026-08-31",
          review_state: "proposed",
        },
      }),
      { warn: () => undefined },
    );

    expect(record.disposition).toBe("needs_adjudication");
    expect(isAcceptedEvaluablePositive(record)).toBe(false);
  });

  it("stamps source and target contract versions on every diagnostic", () => {
    const { diagnostics } = loadLegacyGoldRecord(legacyRecord({ id: "stamps" }), {
      warn: () => undefined,
    });

    expect(diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of diagnostics) {
      expect(diagnostic.sourceContractVersion).toBe(LEGACY_SOURCE_CONTRACT_VERSION);
      expect(diagnostic.targetContractVersion).toBe(CANONICAL_CONTRACT_VERSION);
    }
  });

  it("emits one diagnostic per conversion step and one warn per record", () => {
    const warnings: string[] = [];
    const { diagnostics } = loadLegacyGoldRecord(
      legacyRecord({
        id: "diag-count",
        subject: { key: "pii:email_address", name: "userEmail" },
        expected: { status: "positive", labels: ["email"] },
      }),
      { warn: (message) => warnings.push(message) },
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("diag-count");
    expect(diagnostics.length).toBeGreaterThanOrEqual(5);
    for (const kind of new Set(diagnostics.map((d) => d.conversion))) {
      expect(CONVERSION_KINDS).toContain(kind);
    }
  });

  it("stamps CANONICAL_CONTRACT_VERSION on the output record", () => {
    const { record } = loadLegacyGoldRecord(legacyRecord({ id: "output-stamp" }), {
      warn: () => undefined,
    });
    expect(record.contractVersion).toBe(CANONICAL_CONTRACT_VERSION);
  });

  it("loads through annotationRecordToLegacyInput without semantic changes", () => {
    const annotation: AnnotationRecord = {
      id: "adapter-bridge",
      layer: "pii_signals",
      subject: { key: "pii:email_address", name: "emailField" },
      evidence: {
        file_path: evidence.file_path,
        start_line: evidence.start_line,
        end_line: evidence.end_line,
      },
      rationale: "test",
      expected: { status: "positive", labels: ["email"] },
      provenance: {
        proposed_by: "test",
        proposed_at: "2026-08-31",
        review_state: "accepted",
      },
    };

    const { record } = loadLegacyGoldRecord(annotationRecordToLegacyInput(annotation), {
      warn: () => undefined,
    });

    expect(record.identity.layer).toBe("mentions");
    expect(record.identity.identityKey).toBe("mention:email_address");
  });
});

describe("legacy compat loader invariants", () => {
  const legacyInputs: LegacyGoldRecord[] = [
    legacyRecord({ id: "inv-1", layer: "pii_signals", subject: { key: "pii:email_address" } }),
    legacyRecord({ id: "inv-2", subject: { key: "pii_signal:email" } }),
    legacyRecord({
      id: "inv-3",
      layer: "data_flows",
      subject: { key: "flow:a->b" },
      expected: { status: "positive", labels: [] },
    }),
    legacyRecord({
      id: "inv-4",
      layer: "components",
      subject: { key: "asset:main_db", name: "Database" },
      expected: { status: "positive", labels: ["database"] },
    }),
  ];

  it("never writes pii: or pii_signal: into identity.identityKey", () => {
    for (const input of legacyInputs) {
      const { record } = loadLegacyGoldRecord(input, { warn: () => undefined });
      expect(record.identity.identityKey).not.toMatch(/^pii:/);
      expect(record.identity.identityKey).not.toMatch(/^pii_signal:/);
    }
  });

  it("keeps conversion kind strings in conversions.ts and loader.ts only", () => {
    const compatDir = path.join(__dirname, "../../eval/canonical/compat");
    const adaptersSource = fs.readFileSync(path.join(compatDir, "adapters.ts"), "utf8");
    expect(adaptersSource).not.toContain("corpus_layer_to_canonical");
    expect(adaptersSource).not.toContain("pii_mention_key_exemption");

    const conversionKindsInConversions = CONVERSION_KINDS.every((kind) =>
      fs.readFileSync(path.join(compatDir, "conversions.ts"), "utf8").includes(`"${kind}"`),
    );
    expect(conversionKindsInConversions).toBe(true);
  });

  it("does not import tests/eval/identity.ts from compat modules", () => {
    const compatDir = path.join(__dirname, "../../eval/canonical/compat");
    for (const file of fs.readdirSync(compatDir)) {
      if (!file.endsWith(".ts")) {
        continue;
      }
      const source = fs.readFileSync(path.join(compatDir, file), "utf8");
      expect(source).not.toMatch(/from\s+["'].*\/identity["']/);
      expect(source).not.toContain("EQUIVALENCE_GROUPS");
      expect(source).not.toContain("PARENT_TO_CHILDREN");
    }
  });
});

describe("canonical evaluator isolation via loader output", () => {
  it("does not credit strict correctness from observed-token overlap alone", () => {
    const { record: expectation } = loadLegacyGoldRecord(
      legacyRecord({
        id: "eval-isolation",
        subject: { key: "pii:email_address", name: "sharedToken" },
        expected: { status: "positive", labels: [] },
      }),
      { warn: () => undefined },
    );

    const identityMatch = withId(
      buildScannerFinding({
        layer: "mentions",
        identityKey: expectation.identity.identityKey,
        conceptLeaf: expectation.classification.conceptLeaf,
        evidenceLocations: expectation.evidenceLocations,
      }),
    );

    const tokenOnlyMatch = withId(
      buildScannerFinding({
        layer: "mentions",
        identityKey: "mention:phone",
        conceptLeaf: "phone_number",
        evidenceLocations: expectation.evidenceLocations,
        observedTokenCandidates: expectation.observedTokenCandidates,
      }),
    );

    expect(strictCorrectness(expectation, identityMatch)).toBe(true);
    expect(strictCorrectness(expectation, tokenOnlyMatch)).toBe(false);
  });

  it("does not credit observationsMatch from display text alone", () => {
    const { record: expectation } = loadLegacyGoldRecord(
      legacyRecord({
        id: "display-isolation",
        layer: "data_flows",
        subject: { key: "flow:a->b", name: "Legacy prose" },
        expected: { status: "positive", labels: [] },
      }),
      { warn: () => undefined },
    );

    const finding = withId(
      buildScannerFinding({
        layer: "data-flows",
        identityKey: "flow:x->y",
        conceptLeaf: "data_transfer",
        evidenceLocations: expectation.evidenceLocations,
        displayText: expectation.display?.displayText,
      }),
    );

    expect(observationsMatch(expectation, finding)).toBe(false);
  });
});
