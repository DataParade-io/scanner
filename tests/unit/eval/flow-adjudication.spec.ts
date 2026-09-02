import path from "path";

import {
  ACCEPT_CEILING,
  adjudicateFlowRow,
  analyzeFlowForAdjudication,
  assertFlowAcceptCeiling,
  buildFlowAdjudicationLedger,
  classifyFlowSourceBucket,
  findComponentsReferencedInSpan,
  FLOW_ADJUDICATION_TASK,
  pickIntraEntity,
  shouldDemoteOrmGraphEdge,
  validateFlowEvidence,
} from "../../eval/canonical/compat/flow-adjudication";
import {
  buildFlowMigrationLedger,
  listAcceptedComponentsWithCanonical,
  listComponentCandidatesForFlow,
  proposeFlowCandidate,
  resolveFlowSide,
} from "../../eval/canonical/compat/flow-migration";
import { loadAnnotations } from "../../benchmark/manifest";
import { resolveDefaultBenchmarkRoot } from "../../benchmark/paths";
import type { AnnotationRecord } from "../../benchmark/schema";

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

describe("flow-adjudication", () => {
  it("demotes saleor ORM graph_edge to intra_component_lineage", () => {
    const root = resolveDefaultBenchmarkRoot();
    const repoDir = path.join(root, "repos", "saleor");
    const flows = loadAnnotations(repoDir, "data_flows");
    const flow = flows.find((row) => row.id === "saleor-user-email-persisted");
    expect(flow).toBeDefined();

    const components = listAcceptedComponentsWithCanonical(repoDir);
    const { overlap, rationale, all } = listComponentCandidatesForFlow(flow!, components);
    const migrationCandidate = proposeFlowCandidate(flow!, components);
    expect(migrationCandidate.disposition_candidate).toBe("graph_edge");

    const span = "    email = models.EmailField(unique=True)\n    first_name = models.CharField(max_length=256)";
    const entry = adjudicateFlowRow({
      repoKey: "saleor",
      record: flow!,
      components,
      migrationCandidate,
      overlap,
      rationale,
      allCandidates: all,
      span,
      contextSpan: span,
    });

    expect(entry.disposition).toBe("accept");
    expect(entry.finalDispositionCandidate).toBe("intra_component_lineage");
    expect(entry.sourceEntityId).toBe("saleor::saleor-customer-actor");
    expect(entry.candidate?.disposition_candidate).toBe("intra_component_lineage");
    expect(entry.contested).toBe(true);
  });

  it("resolves wordpress signon via entity picker without negative decoy", () => {
    const root = resolveDefaultBenchmarkRoot();
    const repoDir = path.join(root, "repos", "wordpress");
    const flows = loadAnnotations(repoDir, "data_flows");
    const flow = flows.find((row) => row.id === "wordpress-signon-to-auth-cookie");
    expect(flow).toBeDefined();

    const components = listAcceptedComponentsWithCanonical(repoDir);
    const { overlap, rationale, all } = listComponentCandidatesForFlow(flow!, components);
    const migrationCandidate = proposeFlowCandidate(flow!, components);
    expect(migrationCandidate.disposition_candidate).toBe("unresolved");

    const span =
      "function wp_signon( $credentials, $secure_cookie = '' ) {\n" +
      "\t$user = wp_authenticate( $credentials['user_login'], $credentials['user_password'] );\n" +
      "\tif ( ! is_wp_error( $user ) ) {\n" +
      "\t\twp_set_auth_cookie( $user->ID, $remember );";
    const entry = adjudicateFlowRow({
      repoKey: "wordpress",
      record: flow!,
      components,
      migrationCandidate,
      overlap,
      rationale,
      allCandidates: all,
      span,
      contextSpan: span,
    });

    expect(entry.disposition).toBe("accept");
    expect(entry.sourceBucket).toBe("entity_picker_resolved");
    expect(entry.sourceEntityId).toBe("wordpress::wordpress-auth-cookie-service");
    expect(entry.finalDispositionCandidate).toBe("intra_component_lineage");
    expect(entry.sourceEntityId).not.toContain("not-stripe");
  });

  it("rejects all 17 negative flow rows", () => {
    const ledger = buildFlowMigrationLedger();
    const adjudication = buildFlowAdjudicationLedger();
    const negativeMigration = ledger.entries.filter((entry) => entry.dispositionCandidate === "rejection");
    expect(negativeMigration).toHaveLength(17);

    for (const negative of negativeMigration) {
      const adjudicated = adjudication.entries.find((entry) => entry.annotationId === negative.annotationId);
      expect(adjudicated?.disposition).toBe("reject");
    }
    expect(adjudication.dispositions.reject).toBe(17);
  });

  it("marks ambiguous same-subtype endpoint duplicates unresolved", () => {
    const stripe = componentRecord({
      id: "stripe-a",
      subject: { key: "third_party:stripe", name: "Stripe" },
      canonical: {
        entity_id: "fixture::stripe-a",
        identity_key: "third_party:stripe",
        component_type: "third_party",
        component_subtype: "payment_processor",
        vendor: "stripe",
      },
    });
    const stripeDup = componentRecord({
      id: "stripe-b",
      subject: { key: "third_party:stripe", name: "Stripe duplicate" },
      canonical: {
        entity_id: "fixture::stripe-b",
        identity_key: "third_party:stripe",
        component_type: "third_party",
        component_subtype: "payment_processor",
        vendor: "stripe",
      },
    });

    expect(resolveFlowSide("stripe", [stripe, stripeDup], "Stripe charge").kind).toBe("ambiguous");

    const flow = flowRecord({
      id: "ambiguous-stripe-flow",
      subject: { key: "flow:api->stripe", name: "API to Stripe" },
      rationale: "Stripe charge",
    });
    const migrationCandidate = proposeFlowCandidate(flow, [stripe, stripeDup]);
    expect(migrationCandidate.disposition_candidate).toBe("unresolved");

    const entry = adjudicateFlowRow({
      repoKey: "fixture",
      record: flow,
      components: [stripe, stripeDup],
      migrationCandidate,
      overlap: [],
      rationale: [],
      allCandidates: [stripe, stripeDup],
      span: "stripe.charge();",
      contextSpan: "stripe.charge();",
    });
    expect(entry.disposition).toBe("unresolved");
  });

  it("enforces accept ceiling guard", () => {
    const ledger = buildFlowAdjudicationLedger();
    expect(ledger.acceptCeiling).toBe(ACCEPT_CEILING);
    expect(ledger.dispositions.accept).toBeLessThanOrEqual(ACCEPT_CEILING);
    expect(() => assertFlowAcceptCeiling(ledger)).not.toThrow();
    expect(() =>
      assertFlowAcceptCeiling({
        ...ledger,
        dispositions: { ...ledger.dispositions, accept: ACCEPT_CEILING + 1 },
      }),
    ).toThrow(/Accept ceiling exceeded/);
  });

  it("accounts for all 436 corpus flow rows", () => {
    const ledger = buildFlowAdjudicationLedger();
    expect(ledger.task).toBe(FLOW_ADJUDICATION_TASK);
    expect(ledger.totalRows).toBe(436);
    expect(ledger.entries).toHaveLength(436);
    const sum =
      ledger.dispositions.accept + ledger.dispositions.reject + ledger.dispositions.unresolved;
    expect(sum).toBe(436);
  });

  it("never accepts negative components as flow carriers", () => {
    const stripe = componentRecord({
      id: "not-stripe",
      subject: { key: "third_party:stripe", name: "Stripe" },
      expected: { status: "negative", labels: [] },
      canonical: {
        entity_id: "fixture::not-stripe",
        identity_key: "third_party:payment_processor",
        component_type: "third_party",
        component_subtype: "payment_processor",
        vendor: "stripe",
      },
    });
    const matches = findComponentsReferencedInSpan("wp_set_auth_cookie();", [stripe]);
    expect(matches).toHaveLength(0);
  });

  it("classifies source buckets from migration candidate shape", () => {
    const migrationCandidate = {
      kind: "flow" as const,
      disposition_candidate: "intra_component_lineage" as const,
      candidate_confidence: "low" as const,
      candidate_notes: "low",
      source_entity_id: "a::a",
    };
    const overlap: AnnotationRecord[] = [];
    const bucket = classifyFlowSourceBucket(migrationCandidate, overlap, [], []);
    expect(bucket).toBe("intra_low_rationale_only");
  });

  it("validates flow evidence for ORM spans", () => {
    expect(validateFlowEvidence("email = models.EmailField()", "", "User email persisted")).toBe(
      "verified",
    );
  });

  it("picks actor entity for ORM demotion", () => {
    const actor = componentRecord({
      id: "actor",
      subject: { key: "actor:customer", name: "User" },
      canonical: {
        entity_id: "fixture::actor",
        identity_key: "actor:customer",
        component_type: "actor",
        component_subtype: "customer",
      },
    });
    const database = componentRecord({
      id: "database",
      subject: { key: "asset:database", name: "Database" },
      canonical: {
        entity_id: "fixture::database",
        identity_key: "asset:database",
        component_type: "asset",
        component_subtype: "database",
      },
    });
    const migrationCandidate = {
      kind: "flow" as const,
      disposition_candidate: "graph_edge" as const,
      candidate_confidence: "high" as const,
      candidate_notes: "graph",
    };
    const demoted = shouldDemoteOrmGraphEdge(
      "email = models.EmailField()",
      [actor, database],
      migrationCandidate,
    );
    expect(demoted?.id).toBe("actor");
    expect(pickIntraEntity([actor, database], "email = models.EmailField()", "", [actor, database])?.id).toBe(
      "actor",
    );
  });
});

describe("flow adjudication corpus integration", () => {
  it("analyzes a corpus row when cache is available", () => {
    const root = resolveDefaultBenchmarkRoot();
    const repoDir = path.join(root, "repos", "saleor");
    const flows = loadAnnotations(repoDir, "data_flows");
    const flow = flows.find((row) => row.id === "saleor-user-email-persisted");
    expect(flow).toBeDefined();

    try {
      const entry = analyzeFlowForAdjudication("saleor", flow!, root);
      expect(entry.annotationId).toBe("saleor-user-email-persisted");
      expect(["accept", "reject", "unresolved"]).toContain(entry.disposition);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Cache miss")) {
        throw error;
      }
    }
  });
});
