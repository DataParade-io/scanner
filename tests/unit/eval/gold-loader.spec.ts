import {
  isAcceptedEvaluablePositive,
  isNeedsAdjudication,
  loadCanonicalGoldFromAnnotation,
  loadCanonicalGoldFromEvalCase,
  loadCanonicalGoldFromLegacyRecord,
  ruleIdToConceptLeaf,
  sampleEvidence,
} from "../../eval/canonical";
import type { LegacyGoldRecord } from "../../eval/canonical";
import type { AnnotationRecord } from "../../benchmark/schema";
import { componentEvalCases } from "../../eval/layers/components/cases";
import { dataFlowEvalCases } from "../../eval/layers/data-flows/cases";
import { mentionEvalCases } from "../../eval/layers/mentions/cases";
import { loadAnnotations } from "../../benchmark/manifest";
import path from "path";

const evidence = sampleEvidence("db-client-import.ts", 1, 1);

function legacyRecord(overrides: Partial<LegacyGoldRecord> & Pick<LegacyGoldRecord, "id">): LegacyGoldRecord {
  return {
    layer: "components",
    subject: { key: "asset:database" },
    evidence,
    expected: { status: "positive", labels: ["database"] },
    provenance: {
      proposed_by: "test",
      proposed_at: "2026-08-31",
      review_state: "accepted",
    },
    ...overrides,
  };
}

function corpusAnnotation(overrides: Partial<AnnotationRecord> & Pick<AnnotationRecord, "id">): AnnotationRecord {
  return {
    layer: "components",
    subject: { key: "asset:database", name: "wpdb" },
    evidence,
    rationale: "test corpus row",
    expected: { status: "positive", labels: ["database"] },
    provenance: {
      proposed_by: "test",
      proposed_at: "2026-08-31",
      review_state: "accepted",
    },
    ...overrides,
  };
}

describe("loadCanonicalGoldFromLegacyRecord (corpus-shaped rows)", () => {
  it("maps asset:database with legacy name to structured identity without instance", () => {
    const { record } = loadCanonicalGoldFromLegacyRecord(
      legacyRecord({
        id: "corpus-db",
        subject: { key: "asset:database", name: "wpdb" },
      }),
      { warn: () => undefined, repoKey: "wordpress" },
    );

    expect(record.identity.identityKey).toBe("asset:database");
    expect(record.classification.componentType).toBe("asset");
    expect(record.classification.componentSubtype).toBe("database");
    expect(record.entityId).toBe("wordpress::corpus-db");
    expect(record.optionalAssertion?.instance).toBeUndefined();
    expect(record.observedTokenCandidates?.some((token) => token.value === "wpdb")).toBe(true);
    expect(record.observedTokenCandidates?.some((token) => token.value === "asset:database")).toBe(
      true,
    );
    expect(isAcceptedEvaluablePositive(record)).toBe(true);
  });

  it("maps third_party:checkr with subtype from labels and vendor from key suffix", () => {
    const { record } = loadCanonicalGoldFromLegacyRecord(
      legacyRecord({
        id: "corpus-checkr",
        subject: { key: "third_party:checkr", name: "Checkr" },
        expected: { status: "positive", labels: ["saas_service"] },
      }),
      { warn: () => undefined, repoKey: "vgs-django" },
    );

    expect(record.identity.identityKey).toBe("third_party:saas_service");
    expect(record.identity.identityKey).not.toBe("third_party:checkr");
    expect(record.classification.componentSubtype).toBe("saas_service");
    expect(record.optionalAssertion?.vendor).toBe("checkr");
    expect(record.entityId).toBe("vgs-django::corpus-checkr");
    expect(record.optionalAssertion?.instance).toBeUndefined();
  });

  it("routes accepted corpus data-flow rows to needs_adjudication", () => {
    const { record } = loadCanonicalGoldFromLegacyRecord(
      legacyRecord({
        id: "corpus-flow",
        layer: "data_flows",
        subject: { key: "flow:password->wp_check_password", name: "Password to verifier" },
        expected: { status: "positive", labels: ["data_flow"] },
      }),
      { warn: () => undefined },
    );

    expect(record.identity.layer).toBe("data-flows");
    expect(record.identity.identityKey).toBe("flow:password->wp_check_password");
    expect(record.disposition).toBe("needs_adjudication");
    expect(isNeedsAdjudication(record)).toBe(true);
    expect(isAcceptedEvaluablePositive(record)).toBe(false);
  });

  it("maps canonical mention:email through ruleIdToConceptLeaf", () => {
    const { record } = loadCanonicalGoldFromLegacyRecord(
      legacyRecord({
        id: "corpus-mention-email",
        layer: "mentions",
        subject: { key: "mention:email" },
        expected: { status: "positive", labels: ["email"] },
      }),
      { warn: () => undefined },
    );

    expect(record.identity.identityKey).toBe("mention:email");
    expect(record.classification.conceptLeaf).toBe("email_address");
    expect(record.classification.conceptLeaf).not.toBe(ruleIdToConceptLeaf("username"));
  });

  it("maps mention rule-id suffixes through ruleIdToConceptLeaf", () => {
    const { record, diagnostics } = loadCanonicalGoldFromLegacyRecord(
      legacyRecord({
        id: "corpus-mention-email",
        layer: "mentions",
        subject: { key: "mention:email" },
        expected: { status: "positive", labels: [] },
      }),
      { warn: () => undefined },
    );

    expect(record.classification.conceptLeaf).toBe("email_address");
    expect(record.classification.conceptAncestry).toEqual(["email_address"]);
    expect(diagnostics.some((entry) => entry.conversion === "rule_id_to_concept_leaf")).toBe(true);
  });
});

describe("loadCanonicalGoldFromAnnotation", () => {
  it("round-trips corpus AnnotationRecord rows", () => {
    const { record } = loadCanonicalGoldFromAnnotation(corpusAnnotation({ id: "annotation-bridge" }), {
      warn: () => undefined,
    });

    expect(record.identity.identityKey).toBe("asset:database");
    expect(record.contractVersion).toBeDefined();
  });

  it("loads real corpus annotations for every declared layer", () => {
    const benchmarkRoot = path.join(__dirname, "../../benchmark");
    const repoDir = path.join(benchmarkRoot, "repos", "wordpress");

    const layers = ["components", "data_flows", "mentions", "data_items"] as const;
    for (const layer of layers) {
      const annotations = loadAnnotations(repoDir, layer);
      expect(annotations.length).toBeGreaterThan(0);
      const { record } = loadCanonicalGoldFromAnnotation(annotations[0]!, { warn: () => undefined });
      expect(record.identity.layer).toBeTruthy();
      expect(record.identity.identityKey).toBeTruthy();
    }
  });
});

describe("loadCanonicalGoldFromEvalCase (fixture gold)", () => {
  it("loads every committed fixture case without error", () => {
    const allCases = [
      ...componentEvalCases,
      ...dataFlowEvalCases,
      ...mentionEvalCases,
    ];

    for (const caseRecord of allCases) {
      const { record } = loadCanonicalGoldFromEvalCase(caseRecord, { warn: () => undefined });
      expect(record.id).toBe(caseRecord.id);
      if (caseRecord.layer === "components") {
        expect(record.identity.identityKey).toMatch(/^(asset|third_party|actor):/);
        expect(record.observedTokenCandidates?.some(
          (token) => token.value === caseRecord.subject.key,
        )).toBe(true);
      } else {
        expect(record.identity.identityKey).toBeTruthy();
      }
    }
  });

  it("maps fixture asset:pg label database to classification identity asset:database", () => {
    const fixtureCase = componentEvalCases.find((entry) => entry.id === "ts-pg-database");
    expect(fixtureCase).toBeDefined();

    const { record } = loadCanonicalGoldFromEvalCase(fixtureCase!, { warn: () => undefined });

    expect(record.identity.identityKey).toBe("asset:database");
    expect(record.identity.identityKey).not.toBe("asset:pg");
    expect(record.classification.componentSubtype).toBe("database");
    expect(record.optionalAssertion?.instance).toBeUndefined();
    expect(record.observedTokenCandidates?.some((token) => token.value === "Pg")).toBe(true);
    expect(record.observedTokenCandidates?.some((token) => token.value === "asset:pg")).toBe(true);
  });

  it("routes fixture data-flow positives to needs_adjudication", () => {
    for (const caseRecord of dataFlowEvalCases) {
      if (caseRecord.expected.status !== "positive") {
        continue;
      }
      const { record } = loadCanonicalGoldFromEvalCase(caseRecord, { warn: () => undefined });
      expect(record.disposition).toBe("needs_adjudication");
    }
  });

  it("maps fixture mention:username through ruleIdToConceptLeaf", () => {
    const fixtureCase = mentionEvalCases.find((entry) => entry.id === "mention-jvm-yaml-username");
    expect(fixtureCase).toBeDefined();

    const { record } = loadCanonicalGoldFromEvalCase(fixtureCase!, { warn: () => undefined });

    expect(record.identity.identityKey).toBe("mention:username");
    expect(record.classification.conceptLeaf).toBe("username");
    expect(record.classification.conceptAncestry).toEqual(["user_identifier", "username"]);
  });
});
