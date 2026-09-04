import {
  isAcceptedEvaluablePositive,
  isNeedsAdjudication,
  loadCanonicalGoldFromAnnotation,
  loadCanonicalGoldFromEvalCase,
  ruleIdToConceptLeaf,
  sampleEvidence,
} from "../../eval/canonical";
import { evalCaseToAnnotationRecord } from "../../eval/canonical/gold/fixture-input";
import type { AnnotationRecord } from "../../benchmark/schema";
import { componentEvalCases } from "../../eval/layers/components/cases";
import { dataFlowEvalCases } from "../../eval/layers/data-flows/cases";
import { mentionEvalCases } from "../../eval/layers/mentions/cases";
import { loadAnnotations } from "../../benchmark/manifest";
import { annotationToEvalCase } from "../../benchmark/to-eval-cases";
import path from "path";

const evidence = sampleEvidence("db-client-import.ts", 1, 1);

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

describe("loadCanonicalGoldFromAnnotation (corpus-shaped rows)", () => {
  it("maps structured component canonical blocks to accepted gold", () => {
    const { record } = loadCanonicalGoldFromAnnotation(
      corpusAnnotation({
        id: "corpus-db",
        subject: { key: "asset:database", name: "wpdb" },
        canonical: {
          entity_id: "wordpress::corpus-db",
          identity_key: "asset:database",
          component_type: "asset",
          component_subtype: "database",
        },
      }),
      { repoKey: "wordpress" },
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

  it("maps third_party canonical blocks with vendor from block", () => {
    const { record } = loadCanonicalGoldFromAnnotation(
      corpusAnnotation({
        id: "corpus-checkr",
        subject: { key: "third_party:checkr", name: "Checkr" },
        expected: { status: "positive", labels: ["saas_service"] },
        canonical: {
          entity_id: "vgs-django::corpus-checkr",
          identity_key: "third_party:saas_service",
          component_type: "third_party",
          component_subtype: "saas_service",
          vendor: "checkr",
        },
      }),
      { repoKey: "vgs-django" },
    );

    expect(record.identity.identityKey).toBe("third_party:saas_service");
    expect(record.classification.componentSubtype).toBe("saas_service");
    expect(record.optionalAssertion?.vendor).toBe("checkr");
    expect(record.entityId).toBe("vgs-django::corpus-checkr");
    expect(record.optionalAssertion?.instance).toBeUndefined();
  });

  it("routes accepted corpus data-flow rows without flow_canonical to needs_adjudication", () => {
    const { record } = loadCanonicalGoldFromAnnotation(
      corpusAnnotation({
        id: "corpus-flow",
        layer: "data_flows",
        subject: { key: "flow:password->wp_check_password", name: "Password to verifier" },
        expected: { status: "positive", labels: ["data_flow"] },
      }),
    );

    expect(record.identity.layer).toBe("data-flows");
    expect(record.disposition).toBe("needs_adjudication");
    expect(isNeedsAdjudication(record)).toBe(true);
    expect(isAcceptedEvaluablePositive(record)).toBe(false);
  });

  it("maps canonical mention:email using expected labels", () => {
    const { record } = loadCanonicalGoldFromAnnotation(
      corpusAnnotation({
        id: "corpus-mention-email",
        layer: "mentions",
        subject: { key: "mention:email" },
        expected: { status: "positive", labels: ["email_address"] },
      }),
    );

    expect(record.identity.identityKey).toBe("mention:email");
    expect(record.classification.conceptLeaf).toBe("email_address");
    expect(record.classification.conceptLeaf).not.toBe(ruleIdToConceptLeaf("username"));
  });

  it("falls back to concept-map for mention rule-id suffixes when labels are empty", () => {
    const { record, diagnostics } = loadCanonicalGoldFromAnnotation(
      corpusAnnotation({
        id: "corpus-mention-email",
        layer: "mentions",
        subject: { key: "mention:email" },
        expected: { status: "positive", labels: [] },
      }),
    );

    expect(record.classification.conceptLeaf).toBe("email_address");
    expect(record.classification.conceptAncestry).toEqual(["email_address"]);
    expect(diagnostics).toEqual([]);
  });
});

describe("loadCanonicalGoldFromAnnotation corpus bridge", () => {
  it("round-trips corpus AnnotationRecord rows", () => {
    const { record } = loadCanonicalGoldFromAnnotation(corpusAnnotation({ id: "annotation-bridge" }));

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
      const { record } = loadCanonicalGoldFromAnnotation(annotations[0]!);
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
      const { record } = loadCanonicalGoldFromEvalCase(caseRecord);
      expect(record.id).toBe(caseRecord.id);
      if (caseRecord.layer === "components") {
        expect(record.observedTokenCandidates?.some(
          (token) => token.value === caseRecord.subject.key,
        )).toBe(true);
      } else {
        expect(record.identity.identityKey).toBeTruthy();
      }
    }
  });

  it("preserves fixture component keys with taxonomy-resolved classification identity", () => {
    const fixtureCase = componentEvalCases.find((entry) => entry.id === "ts-pg-database");
    expect(fixtureCase).toBeDefined();

    const { record } = loadCanonicalGoldFromEvalCase(fixtureCase!);

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
      const { record } = loadCanonicalGoldFromEvalCase(caseRecord);
      expect(record.disposition).toBe("needs_adjudication");
    }
  });

  it("maps fixture mention:username through concept-map fallback", () => {
    const fixtureCase = mentionEvalCases.find((entry) => entry.id === "mention-jvm-yaml-username");
    expect(fixtureCase).toBeDefined();

    const { record } = loadCanonicalGoldFromEvalCase(fixtureCase!);

    expect(record.identity.identityKey).toBe("mention:username");
    expect(record.classification.conceptLeaf).toBe("username");
    expect(record.classification.conceptAncestry).toEqual(["user_identifier", "username"]);
  });

  it("preserves accepted flow_canonical through eval-case round-trip", () => {
    const benchmarkRoot = path.join(__dirname, "../../benchmark");
    const repoDir = path.join(benchmarkRoot, "repos", "wordpress");
    const annotations = loadAnnotations(repoDir, "data_flows");
    const acceptedWithCanonical = annotations.filter(
      (annotation) =>
        annotation.provenance.review_state === "accepted" &&
        annotation.expected.status === "positive" &&
        annotation.flow_canonical !== undefined,
    );

    expect(acceptedWithCanonical.length).toBeGreaterThan(0);

    let needsAdjudicationAfterRoundTrip = 0;
    for (const annotation of acceptedWithCanonical) {
      const evalCase = annotationToEvalCase(annotation, "wordpress");
      expect(evalCase).not.toBeNull();
      expect(evalCase!.flow_canonical).toBeDefined();

      const roundTripped = evalCaseToAnnotationRecord(evalCase!);
      const { record } = loadCanonicalGoldFromAnnotation(roundTripped, { repoKey: "wordpress" });

      if (record.disposition === "needs_adjudication") {
        needsAdjudicationAfterRoundTrip += 1;
      }
      expect(record.disposition).toBe("accepted");
      expect(isAcceptedEvaluablePositive(record)).toBe(true);
    }

    expect(needsAdjudicationAfterRoundTrip).toBe(0);
  });
});
