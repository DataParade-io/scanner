import {
  buildComponentEntityIndex,
  buildFlowAnnotationCanonicalBlock,
  buildFlowMigrationLedger,
  candidateEndpointsToAsserted,
  evidenceSpansOverlap,
  FLOW_MIGRATION_TASK,
  proposeFlowCandidate,
  rationaleExplicitlyNamesComponent,
  resolveFlowSide,
  slugMatchesComponent,
} from "../../eval/canonical/compat/flow-migration";
import { loadLegacyGoldRecord, isAcceptedEvaluablePositive } from "../../eval/canonical";
import { annotationRecordToLegacyInput } from "../../eval/canonical/compat/adapters";
import type {
  AnnotationRecord,
  FlowAnnotationCandidate,
  FlowAnnotationCanonical,
} from "../../benchmark/schema";

function flowRecord(overrides: Partial<AnnotationRecord> & Pick<AnnotationRecord, "id">): AnnotationRecord {
  return {
    layer: "data_flows",
    subject: { key: "flow:source->target", name: "Display" },
    evidence: { file_path: "src/app.ts", start_line: 10, end_line: 12 },
    expected: { status: "positive", labels: ["data_flow"] },
    rationale: "Example rationale",
    provenance: {
      proposed_by: "test",
      proposed_at: "2026-09-01",
      review_state: "needs_adjudication",
    },
    ...overrides,
  };
}

function componentRecord(overrides: Partial<AnnotationRecord> & Pick<AnnotationRecord, "id">): AnnotationRecord {
  return {
    layer: "components",
    subject: { key: "asset:api", name: "API" },
    evidence: { file_path: "src/app.ts", start_line: 10, end_line: 12 },
    expected: { status: "positive", labels: ["api"] },
    rationale: "API component",
    provenance: {
      proposed_by: "test",
      proposed_at: "2026-09-01",
      review_state: "accepted",
    },
    canonical: {
      entity_id: "fixture::api",
      identity_key: "asset:api",
      component_type: "asset",
      component_subtype: "api",
    },
    ...overrides,
  };
}

describe("flow-migration endpoint matching", () => {
  it("detects overlapping evidence spans", () => {
    expect(
      evidenceSpansOverlap(
        { file_path: "a.ts", start_line: 10, end_line: 12 },
        { file_path: "a.ts", start_line: 11, end_line: 15 },
      ),
    ).toBe(true);
    expect(
      evidenceSpansOverlap(
        { file_path: "a.ts", start_line: 10, end_line: 12 },
        { file_path: "b.ts", start_line: 10, end_line: 12 },
      ),
    ).toBe(false);
  });

  it("matches rationale-named components in the same file only", () => {
    const component = componentRecord({
      id: "stripe-tp",
      subject: { key: "third_party:stripe", name: "Stripe" },
      evidence: { file_path: "src/billing.ts", start_line: 1, end_line: 1 },
      canonical: {
        entity_id: "fixture::stripe",
        identity_key: "third_party:stripe",
        component_type: "third_party",
        component_subtype: "payment_processor",
        vendor: "stripe",
      },
    });

    expect(rationaleExplicitlyNamesComponent("calls Stripe API", component)).toBe(true);
    expect(rationaleExplicitlyNamesComponent("calls Stripe API", { ...component, evidence: { file_path: "other.ts", start_line: 1, end_line: 1 } })).toBe(true);
  });

  it("resolves sides from slug tokens without proximity heuristics", () => {
    const api = componentRecord({ id: "api" });
    const stripe = componentRecord({
      id: "stripe",
      subject: { key: "third_party:stripe", name: "Stripe" },
      canonical: {
        entity_id: "fixture::stripe",
        identity_key: "third_party:stripe",
        component_type: "third_party",
        component_subtype: "payment_processor",
        vendor: "stripe",
      },
    });

    expect(slugMatchesComponent("stripe", stripe)).toBe(true);
    expect(resolveFlowSide("stripe", [api, stripe], "Stripe charge").kind).toBe("resolved");
    expect(resolveFlowSide("stripe", [stripe, { ...stripe, id: "stripe-dup", canonical: { ...stripe.canonical!, entity_id: "fixture::stripe-dup" } }], "Stripe charge").kind).toBe("ambiguous");
  });

  it("ignores negative components for overlap matching", () => {
    const flow = flowRecord({
      id: "signon-flow",
      subject: { key: "flow:credentials->auth-cookie", name: "Credentials to auth cookie" },
      rationale: "wp_signon authenticates credentials then calls wp_set_auth_cookie on success.",
      evidence: { file_path: "src/wp-includes/user.php", start_line: 109, end_line: 115 },
    });
    const stripe = componentRecord({
      id: "not-stripe",
      subject: { key: "third_party:stripe", name: "Stripe" },
      expected: { status: "negative", labels: [] },
      evidence: { file_path: "src/wp-includes/user.php", start_line: 109, end_line: 109 },
      canonical: {
        entity_id: "fixture::not-stripe",
        identity_key: "third_party:payment_processor",
        component_type: "third_party",
        component_subtype: "payment_processor",
        vendor: "stripe",
      },
    });

    const candidate = proposeFlowCandidate(flow, [stripe]);
    expect(candidate.disposition_candidate).toBe("unresolved");
    expect(candidate.candidate_notes).toContain("no component candidates");
  });

  it("proposes graph_edge when both sides resolve to distinct components", () => {
    const flow = flowRecord({
      id: "billing-flow",
      subject: { key: "flow:api->stripe", name: "API to Stripe" },
      rationale: "Root API calls Stripe API",
      evidence: { file_path: "src/billing.ts", start_line: 20, end_line: 22 },
    });
    const api = componentRecord({
      id: "api",
      evidence: { file_path: "src/billing.ts", start_line: 20, end_line: 22 },
    });
    const stripe = componentRecord({
      id: "stripe",
      subject: { key: "third_party:stripe", name: "Stripe" },
      evidence: { file_path: "src/billing.ts", start_line: 20, end_line: 22 },
      canonical: {
        entity_id: "fixture::stripe",
        identity_key: "third_party:stripe",
        component_type: "third_party",
        component_subtype: "payment_processor",
        vendor: "stripe",
      },
    });

    const candidate = proposeFlowCandidate(flow, [api, stripe]);
    expect(candidate.disposition_candidate).toBe("graph_edge");
    expect(candidate.candidate_identity_key).toBe("flow:asset:api->third_party:stripe");
    expect(candidate.endpoints?.target.component_type).toBe("third_party");
  });
});

describe("flow candidate loader integration", () => {
  it("does not apply component_canonical_block to flow rows with accidental canonical", () => {
    const flow = flowRecord({
      id: "flow-with-component-canonical",
      canonical: {
        entity_id: "fixture::oops",
        identity_key: "asset:api",
        component_type: "asset",
        component_subtype: "api",
      },
    });

    const { record, diagnostics } = loadLegacyGoldRecord(annotationRecordToLegacyInput(flow), {
      warn: () => undefined,
      repoKey: "fixture",
    });

    expect(record.classification.componentType).toBeUndefined();
    expect(diagnostics.some((entry) => entry.conversion === "component_canonical_block")).toBe(false);
    expect(record.disposition).toBe("needs_adjudication");
  });

  it("populates flowEndpoints from candidate but keeps needs_adjudication", () => {
    const candidate: FlowAnnotationCandidate = {
      kind: "flow",
      disposition_candidate: "graph_edge",
      candidate_confidence: "high",
      candidate_notes: "test proposal",
      candidate_identity_key: "flow:asset:api->third_party:stripe",
      proposed_flow_type: "api_call",
      proposed_data_categories: ["payment_card"],
      endpoints: {
        source: { component_type: "asset", endpoint_key: "api" },
        target: { component_type: "third_party", endpoint_key: "stripe", vendor: "stripe" },
      },
    };

    const flow = flowRecord({ id: "typed-candidate", candidate });
    const { record, diagnostics } = loadLegacyGoldRecord(annotationRecordToLegacyInput(flow), {
      warn: () => undefined,
      repoKey: "fixture",
    });

    expect(record.flowEndpoints?.source.componentType).toBe("asset");
    expect(record.flowEndpoints?.target.componentType).toBe("third_party");
    expect(record.flowAssertion?.dataCategories).toEqual(["payment_card"]);
    expect(record.disposition).toBe("needs_adjudication");
    expect(isAcceptedEvaluablePositive(record)).toBe(false);
    expect(diagnostics.some((entry) => entry.conversion === "flow_candidate_block")).toBe(true);
  });

  it("preserves expected.labels through loader conversion", () => {
    const flow = flowRecord({
      id: "labels-preserved",
      expected: { status: "positive", labels: ["data_flow"] },
      candidate: {
        kind: "flow",
        disposition_candidate: "unresolved",
        candidate_confidence: "low",
        candidate_notes: "no match",
        proposed_flow_type: "api_call",
      },
    });

    const legacy = annotationRecordToLegacyInput(flow);
    expect(legacy.expected.labels).toEqual(["data_flow"]);
  });
});

describe("flow migration ledger accounting", () => {
  it("accounts for all 436 corpus flow rows", () => {
    const ledger = buildFlowMigrationLedger();
    expect(ledger.task).toBe(FLOW_MIGRATION_TASK);
    expect(ledger.totalRows).toBe(436);
    const bucketSum =
      ledger.buckets.graph_edge +
      ledger.buckets.intra_component_lineage +
      ledger.buckets.rejection +
      ledger.buckets.unresolved;
    expect(bucketSum).toBe(436);
    expect(ledger.entries).toHaveLength(436);
  });

  it("round-trips candidate endpoints through asserted flow endpoints", () => {
    const candidate: FlowAnnotationCandidate = {
      kind: "flow",
      disposition_candidate: "graph_edge",
      candidate_confidence: "high",
      candidate_notes: "test",
      endpoints: {
        source: { component_type: "asset", endpoint_key: "api" },
        target: { component_type: "third_party", endpoint_key: "stripe", vendor: "stripe" },
      },
    };
    const endpoints = candidateEndpointsToAsserted(candidate);
    expect(endpoints?.target.optionalAssertion?.vendor).toBe("stripe");
  });
});

describe("buildFlowAnnotationCanonicalBlock", () => {
  it("synthesizes self-loop typed endpoints for intra-component lineage", () => {
    const component = componentRecord({
      id: "auth-service",
      subject: { key: "asset:auth_service", name: "Auth" },
      canonical: {
        entity_id: "directus::directus-local-verify",
        identity_key: "asset:auth_service",
        component_type: "asset",
        component_subtype: "auth_service",
      },
    });
    const index = buildComponentEntityIndex([component]);
    const block = buildFlowAnnotationCanonicalBlock(
      "directus::directus-local-verify",
      "directus::directus-local-verify",
      "intra_component_lineage",
      index,
      { dataCategories: ["password"] },
    );

    expect(block.identity_key).toBe("flow:asset:auth_service->asset:auth_service");
    expect(block.endpoints.source).toEqual(block.endpoints.target);
    expect(block.endpoints.source.component_type).toBe("asset");
    expect(block.data_categories).toEqual(["password"]);
  });

  it("throws when source entity is missing from component index", () => {
    const index = buildComponentEntityIndex([]);
    expect(() =>
      buildFlowAnnotationCanonicalBlock(
        "missing::entity",
        "missing::entity",
        "intra_component_lineage",
        index,
      ),
    ).toThrow(/Missing component canonical for source entity/);
  });
});

describe("flow_canonical_block loader integration", () => {
  it("promotes accepted flow with flow_canonical to accepted disposition", () => {
    const flowCanonical: FlowAnnotationCanonical = {
      identity_key: "flow:asset:auth_service->asset:auth_service",
      disposition_candidate: "intra_component_lineage",
      source_entity_id: "directus::directus-local-verify",
      target_entity_id: "directus::directus-local-verify",
      endpoints: {
        source: {
          component_type: "asset",
          endpoint_key: "auth_service",
          component_subtype: "auth_service",
        },
        target: {
          component_type: "asset",
          endpoint_key: "auth_service",
          component_subtype: "auth_service",
        },
      },
      data_categories: ["password"],
    };

    const flow = flowRecord({
      id: "promoted-flow",
      provenance: {
        proposed_by: "test",
        proposed_at: "2026-09-01",
        review_state: "accepted",
      },
      flow_canonical: flowCanonical,
    });

    const { record, diagnostics } = loadLegacyGoldRecord(annotationRecordToLegacyInput(flow), {
      warn: () => undefined,
      repoKey: "directus",
    });

    expect(record.disposition).toBe("accepted");
    expect(record.identity.identityKey).toBe(flowCanonical.identity_key);
    expect(record.flowEndpoints?.source.componentType).toBe("asset");
    expect(record.flowAssertion?.dataCategories).toEqual(["password"]);
    expect(isAcceptedEvaluablePositive(record)).toBe(true);
    expect(diagnostics.some((entry) => entry.conversion === "flow_canonical_block")).toBe(true);
  });
});
