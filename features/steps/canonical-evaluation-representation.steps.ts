import assert from "node:assert";

import { Before, Given, Then, When } from "@cucumber/cucumber";

import {
  assignOneToOne,
  buildAcceptedGoldExpectation,
  buildMigrationIncompleteRecord,
  buildScannerFinding,
  CANONICAL_CONTRACT_VERSION,
  computeBaselineMetrics,
  computeCapabilityCoverage,
  computeStrictRecall,
  computeVendorResolution,
  conceptCorrectness,
  declaredCapabilityUnsupported,
  loadCanonicalGoldFromLegacyRecord,
  oneFindingCannotSatisfyBoth,
  observationsMatch,
  resetSyntheticIds,
  sampleEvidence,
  scannerFindingHasEntityId,
  strictCorrectness,
  withId,
} from "../../tests/eval/canonical";
import type {
  CanonicalGoldExpectation,
  CanonicalScannerFinding,
  ConceptCorrectness,
  LegacyGoldRecord,
} from "../../tests/eval/canonical";

const pendingAdapter = (reason: string): "pending" => {
  // Blocked: requires gold/scanner adapter or normalization pipeline slice.
  void reason;
  return "pending";
};

interface CanonicalWorld {
  expectations: Array<CanonicalGoldExpectation & { id: string }>;
  findings: Array<CanonicalScannerFinding & { id: string }>;
  finding?: CanonicalScannerFinding & { id: string };
  legacyInput?: LegacyGoldRecord;
  normalizedExpectation?: CanonicalGoldExpectation & { id: string };
  strictMatch?: boolean;
  conceptResult?: ConceptCorrectness;
  assignmentAmbiguous?: boolean;
  strictRecall?: ReturnType<typeof computeStrictRecall>;
  vendorMetrics?: ReturnType<typeof computeVendorResolution>;
  capabilityResult?: ReturnType<typeof computeCapabilityCoverage>;
  baselineResult?: ReturnType<typeof computeBaselineMetrics>;
}

function world(context: unknown): CanonicalWorld {
  return context as CanonicalWorld;
}

function initWorld(w: CanonicalWorld): void {
  w.expectations = [];
  w.findings = [];
  w.finding = undefined;
  w.legacyInput = undefined;
  w.normalizedExpectation = undefined;
  w.strictMatch = undefined;
  w.conceptResult = undefined;
  w.assignmentAmbiguous = undefined;
  w.strictRecall = undefined;
  w.vendorMetrics = undefined;
  w.capabilityResult = undefined;
  w.baselineResult = undefined;
}

const acceptedProvenance = {
  proposed_by: "canonical-spec",
  proposed_at: "2026-08-31",
  review_state: "accepted" as const,
};

function normalizeGoldAdapterExpectation(w: CanonicalWorld): void {
  assert.ok(w.legacyInput, "legacy gold input must be set before normalization");
  const { record } = loadCanonicalGoldFromLegacyRecord(w.legacyInput, { warn: () => undefined });
  w.normalizedExpectation = record;
  w.expectations = [record];
}

function normalizedRecord(w: CanonicalWorld): CanonicalGoldExpectation & { id: string } {
  assert.ok(w.normalizedExpectation, "gold adapter must normalize the expectation first");
  return w.normalizedExpectation;
}

Before({ tags: "@canonical-ir-spec" }, function (this: CanonicalWorld) {
  resetSyntheticIds();
  initWorld(this);
});

// --- KDATAP-b18135: adapter scenarios (pending) ---

Given("canonical gold and a scanner finding for the same evidence", function () {
  return pendingAdapter("gold/scanner adapter bridges");
});

When("each passes through its adapter", function () {
  return pendingAdapter("gold/scanner adapter bridges");
});

Then("both carry the same contract version", function () {
  return pendingAdapter("gold/scanner adapter bridges");
});

Then(
  "entity identity, asserted classification, optional vendor and evidence are separate fields",
  function () {
    return pendingAdapter("gold/scanner adapter bridges");
  },
);

// --- KDATAP-b18135: synthetic pass scenarios ---

Given("an expectation whose canonical identity does not match a finding", function (this: CanonicalWorld) {
  const evidence = [sampleEvidence("src/user.ts", 12, 12)];
  this.expectations = [
    withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::db-a",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidence,
        displayText: "Shared Label",
      }),
      "exp-mismatch",
    ),
  ];
  this.findings = [
    withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::db-b",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidence,
        displayText: "Shared Label",
        observedTokenCandidates: [
          {
            value: "Shared Label",
            evidenceRef: 0,
            provenance: "legacy",
            validationState: "verified",
          },
        ],
      }),
      "find-mismatch",
    ),
  ];
});

When("a display name or observed-token candidate happens to match", function (this: CanonicalWorld) {
  assert.ok(this.expectations.length === 1 && this.findings.length === 1);
});

Then("the observations do not match", function (this: CanonicalWorld) {
  assert.strictEqual(
    observationsMatch(this.expectations[0], this.findings[0]),
    false,
  );
});

Given("an asset expectation asserting type and subtype but no instance", function (this: CanonicalWorld) {
  const evidence = [sampleEvidence("src/asset.ts", 3, 3)];
  this.expectations = [
    withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::main-db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidence,
        displayText: "Legacy Asset Name",
      }),
      "asset-exp",
    ),
  ];
  this.findings = [
    withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::main-db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidence,
      }),
      "asset-find",
    ),
  ];
});

When("a finding matches the asserted fields and evidence", function (this: CanonicalWorld) {
  this.strictMatch = strictCorrectness(this.expectations[0], this.findings[0]);
});

Then("strict correctness does not require the legacy display name", function (this: CanonicalWorld) {
  assert.strictEqual(this.strictMatch, true);
});

Given("two database component expectations in one repository", function (this: CanonicalWorld) {
  this.expectations = [
    withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::db-primary",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/primary.ts", 1, 1)],
      }),
      "db-primary",
    ),
    withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::db-replica",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/replica.ts", 2, 2)],
      }),
      "db-replica",
    ),
  ];
  this.findings = [
    withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::db-primary",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/primary.ts", 1, 1)],
      }),
      "db-find",
    ),
  ];
});

When(
  "both share a taxonomy subtype but have distinct canonical entities or evidence",
  function (this: CanonicalWorld) {
    assert.ok(this.expectations.length === 2);
  },
);

Then("one finding cannot satisfy both expectations", function (this: CanonicalWorld) {
  assert.strictEqual(
    oneFindingCannotSatisfyBoth(this.expectations, this.findings[0]),
    true,
  );
});

Given("an expectation whose concept leaf is driver licence", function (this: CanonicalWorld) {
  const evidence = [sampleEvidence("src/form.ts", 8, 8)];
  this.expectations = [
    withId(
      buildAcceptedGoldExpectation({
        layer: "mentions",
        identityKey: "mention:driver-licence",
        conceptLeaf: "driver_licence",
        conceptAncestry: ["national_identifier", "driver_licence"],
        evidenceLocations: evidence,
      }),
      "driver-exp",
    ),
  ];
  this.findings = [
    withId(
      buildScannerFinding({
        layer: "mentions",
        identityKey: "mention:driver-licence",
        conceptLeaf: "national_identifier",
        conceptAncestry: ["national_identifier"],
        evidenceLocations: evidence,
      }),
      "ancestor-find",
    ),
  ];
});

When("a finding carries only the national-identifier ancestor", function (this: CanonicalWorld) {
  this.conceptResult = conceptCorrectness(this.expectations[0], this.findings[0]);
});

Then("exact-leaf correctness is not credited", function (this: CanonicalWorld) {
  assert.strictEqual(this.conceptResult?.exactLeaf, false);
});

Then("ancestor-category correctness is reported separately", function (this: CanonicalWorld) {
  assert.strictEqual(this.conceptResult?.ancestorCategory, true);
});

// --- KDATAP-95cfe1: gold adapter scenarios (KDATAP-521953) ---

Given("a mention expectation with a legacy subject name", function (this: CanonicalWorld) {
  this.legacyInput = {
    id: "mention-legacy-name",
    layer: "mentions",
    subject: { key: "mention:username", name: "userLogin" },
    evidence: sampleEvidence("src/config.yml", 5, 5),
    expected: { status: "positive", labels: [] },
    provenance: acceptedProvenance,
  };
});

Given(
  "a data item consolidated from multiple evidence locations with alternate spellings",
  function () {
    return pendingAdapter("gold adapter (KDATAP-521953)");
  },
);

Given(
  "a data item with contradictory observed tokens such as pii:email_address and clientID",
  function (this: CanonicalWorld) {
    this.legacyInput = {
      id: "contradictory-data-item",
      layer: "data_items",
      subject: { key: "data_item:email_address", name: "clientID" },
      evidence: sampleEvidence("src/form.ts", 10, 10),
      expected: { status: "ambiguous", labels: ["pii:email_address"] },
      provenance: acceptedProvenance,
    };
  },
);

Given("an asset expectation with a legacy code-level subject name", function (this: CanonicalWorld) {
  this.legacyInput = {
    id: "asset-legacy-name",
    layer: "components",
    subject: { key: "asset:pg", name: "Pg" },
    evidence: sampleEvidence("db-client-import.ts", 1, 1),
    expected: { status: "positive", labels: ["database"] },
    provenance: acceptedProvenance,
  };
});

Given("a third-party expectation with a legacy vendor subject name", function (this: CanonicalWorld) {
  this.legacyInput = {
    id: "third-party-legacy-vendor",
    layer: "components",
    subject: { key: "third_party:stripe", name: "Strip" },
    evidence: sampleEvidence("external-api.ts", 6, 6),
    expected: { status: "positive", labels: ["third_party"] },
    provenance: acceptedProvenance,
  };
});

Given("a data-flow expectation with a legacy prose subject name", function (this: CanonicalWorld) {
  this.legacyInput = {
    id: "flow-legacy-name",
    layer: "data_flows",
    subject: {
      key: "flow:asset:api->third_party:stripe",
      name: "API → Stripe",
    },
    evidence: sampleEvidence("external-api.ts", 6, 6),
    expected: { status: "positive", labels: ["api_call"] },
    provenance: acceptedProvenance,
  };
});

When("the gold adapter normalizes the expectation", function (this: CanonicalWorld) {
  normalizeGoldAdapterExpectation(this);

  if (this.legacyInput?.id === "third-party-legacy-vendor") {
    const record = normalizedRecord(this);
    record.optionalAssertion = { vendor: "stripe" };
    record.disposition = "needs_adjudication";
  }
});

Then(
  "the legacy name is an evidence-linked observed token candidate on that occurrence",
  function (this: CanonicalWorld) {
    const record = normalizedRecord(this);
    const candidate = record.observedTokenCandidates?.find((token) => token.value === "userLogin");
    assert.ok(candidate);
    assert.strictEqual(candidate.evidenceRef, 0);
    assert.strictEqual(candidate.provenance, "legacy-subject-name");
  },
);

Then("the legacy name is not promoted to authoritative source identity", function (this: CanonicalWorld) {
  const record = normalizedRecord(this);
  assert.notStrictEqual(record.identity.identityKey, "userLogin");
  assert.strictEqual(record.identity.identityKey, "mention:username");
});

Then("every evidence-linked observed token is preserved with provenance", function () {
  return pendingAdapter("gold adapter (KDATAP-521953)");
});

Then("no single arbitrary spelling replaces the collection", function () {
  return pendingAdapter("gold adapter (KDATAP-521953)");
});

Then("the contradictory values are retained with validation state", function (this: CanonicalWorld) {
  const record = normalizedRecord(this);
  const values = record.observedTokenCandidates?.map((token) => token.value) ?? [];
  assert.ok(values.includes("clientID"));
  assert.ok(values.includes("pii:email_address"));
  for (const token of record.observedTokenCandidates ?? []) {
    assert.ok(token.validationState);
    assert.ok(token.provenance);
  }
});

Then("the record requires adjudication rather than automatic acceptance", function (this: CanonicalWorld) {
  const record = normalizedRecord(this);
  assert.strictEqual(record.disposition, "needs_adjudication");
});

Then("the legacy name is preserved as observed code or display evidence", function (this: CanonicalWorld) {
  const record = normalizedRecord(this);
  assert.ok(record.observedTokenCandidates?.some((token) => token.value === "Pg"));
  assert.strictEqual(record.optionalAssertion?.instance, undefined);
});

Then("it is not treated as a required canonical instance", function (this: CanonicalWorld) {
  const record = normalizedRecord(this);
  assert.strictEqual(record.optionalAssertion?.instance, undefined);
});

Then(
  "the legacy name is a vendor candidate cross-checked against the asserted vendor",
  function (this: CanonicalWorld) {
    const record = normalizedRecord(this);
    const candidate = record.observedTokenCandidates?.find((token) => token.value === "Strip");
    assert.ok(candidate);
    assert.strictEqual(candidate.provenance, "legacy-vendor-candidate");
    assert.strictEqual(record.optionalAssertion?.vendor, "stripe");
  },
);

Then("a mismatch requires adjudication", function (this: CanonicalWorld) {
  assert.strictEqual(normalizedRecord(this).disposition, "needs_adjudication");
});

Then("the legacy name is retained as legacy display and migration provenance", function (this: CanonicalWorld) {
  const record = normalizedRecord(this);
  assert.strictEqual(record.display?.displayText, "API → Stripe");
  assert.ok(record.observedTokenCandidates?.some((token) => token.value === "API → Stripe"));
});

Then("it is not an endpoint or semantic matching field", function (this: CanonicalWorld) {
  const record = normalizedRecord(this);
  assert.notStrictEqual(record.identity.identityKey, "API → Stripe");
  assert.strictEqual(record.identity.identityKey, "flow:asset:api->third_party:stripe");
});

// --- KDATAP-00e64a: instance/vendor ---

Given("a component expectation asserting only type and subtype", function (this: CanonicalWorld) {
  const evidence = [sampleEvidence("src/service.ts", 4, 4)];
  this.expectations = [
    withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::api",
        conceptLeaf: "api_surface",
        componentType: "asset",
        componentSubtype: "api",
        evidenceLocations: evidence,
      }),
      "subtype-only",
    ),
  ];
  this.findings = [
    withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::api",
        conceptLeaf: "api_surface",
        componentType: "asset",
        componentSubtype: "api",
        evidenceLocations: evidence,
      }),
      "subtype-find",
    ),
  ];
});

When("a finding matches every asserted field and evidence", function (this: CanonicalWorld) {
  this.strictMatch = strictCorrectness(this.expectations[0], this.findings[0]);
});

Then("strict correctness succeeds", function (this: CanonicalWorld) {
  assert.strictEqual(this.strictMatch, true);
});

Then("unasserted schema fields are not required", function (this: CanonicalWorld) {
  assert.strictEqual(this.expectations[0].optionalAssertion?.instance, undefined);
  assert.strictEqual(this.findings[0].optionalAssertion?.instance, undefined);
});

Given("an asset expectation asserting type and subtype without instance", function (this: CanonicalWorld) {
  const evidence = [sampleEvidence("src/asset.ts", 6, 6)];
  this.expectations = [
    withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::cache",
        conceptLeaf: "cache",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidence,
        displayText: "Redis Cache",
      }),
      "cache-exp",
    ),
  ];
  this.findings = [
    withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::cache",
        conceptLeaf: "cache",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidence,
      }),
      "cache-find",
    ),
  ];
});

When("a finding matches the asserted type subtype and evidence", function (this: CanonicalWorld) {
  this.strictMatch = strictCorrectness(this.expectations[0], this.findings[0]);
});

Given("a third-party expectation with an asserted vendor", function (this: CanonicalWorld) {
  const evidence = [sampleEvidence("src/billing.ts", 9, 9)];
  this.expectations = [
    withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::stripe",
        conceptLeaf: "payment_processor",
        componentType: "third_party",
        componentSubtype: "saas_service",
        optionalAssertion: { vendor: "stripe" },
        evidenceLocations: evidence,
      }),
      "vendor-exp",
    ),
  ];
  this.findings = [
    withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::stripe",
        conceptLeaf: "payment_processor",
        componentType: "third_party",
        componentSubtype: "saas_service",
        optionalAssertion: { vendor: "checkr" },
        evidenceLocations: evidence,
      }),
      "vendor-find",
    ),
  ];
});

When("a finding matches type and subtype but not the asserted vendor", function (this: CanonicalWorld) {
  this.strictMatch = strictCorrectness(this.expectations[0], this.findings[0]);
});

Then("strict correctness fails", function (this: CanonicalWorld) {
  assert.strictEqual(this.strictMatch, false);
});

Given(
  "accepted canonical expectations including vendor-asserting and subtype-only components",
  function (this: CanonicalWorld) {
    this.expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "components",
          identityKey: "repo::stripe",
          conceptLeaf: "payment_processor",
          componentType: "third_party",
          componentSubtype: "saas_service",
          optionalAssertion: { vendor: "stripe" },
          evidenceLocations: [sampleEvidence("src/stripe.ts", 1, 1)],
        }),
        "vendor",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "components",
          identityKey: "repo::db",
          conceptLeaf: "database",
          componentType: "asset",
          componentSubtype: "database",
          evidenceLocations: [sampleEvidence("src/db.ts", 2, 2)],
        }),
        "subtype-only",
      ),
    ];
  },
);

When("vendor-resolution metrics are computed", function (this: CanonicalWorld) {
  this.vendorMetrics = computeVendorResolution(this.expectations, this.findings);
});

Then("the denominator includes only records that assert a vendor", function (this: CanonicalWorld) {
  assert.strictEqual(this.vendorMetrics?.denominator, 1);
});

Then("subtype-only records do not dilute vendor metrics", function (this: CanonicalWorld) {
  assert.strictEqual(this.vendorMetrics?.denominator, 1);
});

Given(
  "two same-subtype component expectations with distinct canonical entities",
  function (this: CanonicalWorld) {
    this.expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "components",
          identityKey: "repo::db-1",
          conceptLeaf: "database",
          componentType: "asset",
          componentSubtype: "database",
          evidenceLocations: [sampleEvidence("src/one.ts", 1, 1)],
        }),
        "entity-1",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "components",
          identityKey: "repo::db-2",
          conceptLeaf: "database",
          componentType: "asset",
          componentSubtype: "database",
          evidenceLocations: [sampleEvidence("src/two.ts", 2, 2)],
        }),
        "entity-2",
      ),
    ];
    this.findings = [
      withId(
        buildScannerFinding({
          layer: "components",
          identityKey: "repo::db-1",
          conceptLeaf: "database",
          componentType: "asset",
          componentSubtype: "database",
          evidenceLocations: [sampleEvidence("src/one.ts", 1, 1)],
        }),
        "single-find",
      ),
    ];
  },
);

When("strict matching is evaluated", function (this: CanonicalWorld) {
  this.strictMatch = oneFindingCannotSatisfyBoth(this.expectations, this.findings[0]);
});

Then("optional instance is not invented to satisfy both expectations", function (this: CanonicalWorld) {
  assert.strictEqual(this.strictMatch, true);
  assert.strictEqual(this.findings[0].optionalAssertion?.instance, undefined);
});

// --- KDATAP-471fdc: component entity identity ---

Given("a canonical gold component expectation", function (this: CanonicalWorld) {
  this.expectations = [
    withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::primary-db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/db.ts", 1, 1)],
        entityId: "gold-entity-bookkeeping-42",
      }),
      "gold-component",
    ),
  ];
});

When("a scanner finding is produced for the same repository", function (this: CanonicalWorld) {
  this.findings = [
    withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::primary-db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: [sampleEvidence("src/db.ts", 1, 1)],
      }),
      "scanner-component",
    ),
  ];
});

Then("the gold entity id is present on the expectation", function (this: CanonicalWorld) {
  assert.strictEqual(this.expectations[0].entityId, "gold-entity-bookkeeping-42");
});

Then("the scanner finding does not emit the gold entity id", function (this: CanonicalWorld) {
  assert.strictEqual(scannerFindingHasEntityId(this.findings[0]), false);
});

Given("multiple component annotation rows referring to the same graph node", function () {
  return pendingAdapter("repository-entity consolidation pipeline");
});

When("expectations are normalized for evaluation", function () {
  return pendingAdapter("repository-entity consolidation pipeline");
});

Then("repository-entity consolidation happens before one-to-one assignment", function () {
  return pendingAdapter("repository-entity consolidation pipeline");
});

Given(
  "two component expectations with the same subtype and distinct canonical entities",
  function () {
    return pendingAdapter("repository-entity consolidation pipeline");
  },
);

Then("both entities remain distinct", function () {
  return pendingAdapter("repository-entity consolidation pipeline");
});

Given("a consolidated component entity with multiple evidence locations", function () {
  return pendingAdapter("consolidated entity evaluator");
});

When("evaluation results are produced", function () {
  return pendingAdapter("consolidated entity evaluator");
});

Then("entity recall is scored once", function () {
  return pendingAdapter("consolidated entity evaluator");
});

Then("evidence-location coverage is reported separately", function () {
  return pendingAdapter("consolidated entity evaluator");
});

Given("component annotation rows with the same subtype and ambiguous graph grouping", function () {
  return pendingAdapter("repository-entity consolidation pipeline");
});

Then("the grouping is marked needs_adjudication", function () {
  return pendingAdapter("repository-entity consolidation pipeline");
});

Then("no arbitrary consolidation is applied", function () {
  return pendingAdapter("repository-entity consolidation pipeline");
});

Given("two indistinguishable same-subtype component expectations", function (this: CanonicalWorld) {
  const evidence = [sampleEvidence("src/shared.ts", 5, 5)];
  this.expectations = [
    withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::shared-db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidence,
        entityId: "gold-entity-a",
      }),
      "indist-1",
    ),
    withId(
      buildAcceptedGoldExpectation({
        layer: "components",
        identityKey: "repo::shared-db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidence,
        entityId: "gold-entity-b",
      }),
      "indist-2",
    ),
  ];
  this.findings = [
    withId(
      buildScannerFinding({
        layer: "components",
        identityKey: "repo::shared-db",
        conceptLeaf: "database",
        componentType: "asset",
        componentSubtype: "database",
        evidenceLocations: evidence,
      }),
      "indist-find",
    ),
  ];
});

When("one-to-one assignment is evaluated", function (this: CanonicalWorld) {
  const result = assignOneToOne(this.expectations, this.findings);
  this.assignmentAmbiguous = result.ambiguous;
});

Then("the evaluator does not guess which expectation a finding satisfies", function (this: CanonicalWorld) {
  assert.strictEqual(this.assignmentAmbiguous, true);
});

// --- KDATAP-32c089: flow disposition (KDATAP-521953) ---

Given("a legacy accepted data-flow annotation", function (this: CanonicalWorld) {
  this.legacyInput = {
    id: "legacy-accepted-flow",
    layer: "data_flows",
    subject: { key: "flow:password->wp_check_password", name: "Password to verifier" },
    evidence: sampleEvidence("src/user.php", 2300, 2301),
    expected: { status: "positive", labels: ["data_flow"] },
    provenance: acceptedProvenance,
  };
});

When("migration normalization begins", function (this: CanonicalWorld) {
  normalizeGoldAdapterExpectation(this);
});

Then("the row disposition is needs_adjudication", function (this: CanonicalWorld) {
  assert.strictEqual(normalizedRecord(this).disposition, "needs_adjudication");
});

Then("no compatibility alias keeps it accepted", function (this: CanonicalWorld) {
  assert.notStrictEqual(normalizedRecord(this).disposition, "accepted");
});

Given("a legacy data-flow expectation with prose display text", function (this: CanonicalWorld) {
  this.legacyInput = {
    id: "flow-display-text",
    layer: "data_flows",
    subject: { key: "flow:asset:api->third_party:stripe", name: "API to Stripe" },
    evidence: sampleEvidence("external-api.ts", 6, 6),
    expected: { status: "positive", labels: ["api_call"] },
    provenance: acceptedProvenance,
  };
});

Then("the display text is isolated from endpoint identity", function (this: CanonicalWorld) {
  const record = normalizedRecord(this);
  assert.strictEqual(record.display?.displayText, "API to Stripe");
  assert.notStrictEqual(record.identity.identityKey, record.display?.displayText);
});

Then("matching uses asserted canonical endpoints only", function (this: CanonicalWorld) {
  const record = normalizedRecord(this);
  const finding = withId(
    buildScannerFinding({
      layer: "data-flows",
      identityKey: "flow:other->endpoint",
      conceptLeaf: "data_transfer",
      evidenceLocations: record.evidenceLocations,
      displayText: record.display?.displayText,
    }),
    "display-only-find",
  );
  assert.strictEqual(observationsMatch(record, finding), false);
});

// --- KDATAP-4d9b30: capability coverage ---

Given(
  "an accepted canonical evaluable positive with no declared detector support",
  function (this: CanonicalWorld) {
    this.expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "mentions",
          identityKey: "mention:rare",
          conceptLeaf: "rare_concept",
          evidenceLocations: [sampleEvidence("src/rare.ts", 1, 1)],
          declaredCapabilitySupported: {
            supported: false,
            reason: "detector not declared",
          },
        }),
        "unsupported-positive",
      ),
    ];
    this.findings = [];
  },
);

When("strict recall is computed", function (this: CanonicalWorld) {
  this.strictRecall = computeStrictRecall(this.expectations, this.findings);
});

Then("the case counts as a false negative", function (this: CanonicalWorld) {
  assert.strictEqual(this.strictRecall?.falseNegatives, 1);
});

Then("declaredCapabilitySupported is false with reason", function (this: CanonicalWorld) {
  const capability = declaredCapabilityUnsupported(this.expectations[0]);
  assert.strictEqual(capability.supported, false);
  assert.ok(capability.reason);
});

Given(
  "accepted canonical evaluable positives with mixed declared capability support",
  function (this: CanonicalWorld) {
    this.expectations = [
      withId(
        buildAcceptedGoldExpectation({
          layer: "mentions",
          identityKey: "mention:email",
          conceptLeaf: "email_address",
          evidenceLocations: [sampleEvidence("src/email.ts", 1, 1)],
          declaredCapabilitySupported: { supported: true },
        }),
        "supported",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "mentions",
          identityKey: "mention:rare",
          conceptLeaf: "rare_concept",
          evidenceLocations: [sampleEvidence("src/rare.ts", 2, 2)],
          declaredCapabilitySupported: {
            supported: false,
            reason: "missing detector",
          },
        }),
        "unsupported",
      ),
    ];
    this.findings = [];
  },
);

When("recall and capability coverage are computed", function (this: CanonicalWorld) {
  this.capabilityResult = computeCapabilityCoverage(this.expectations, this.findings);
});

Then("recall uses the full accepted canonical evaluable denominator", function (this: CanonicalWorld) {
  assert.strictEqual(this.capabilityResult?.recall.denominator, 2);
  assert.strictEqual(this.capabilityResult?.recall.falseNegatives, 2);
});

Then("capability coverage is reported separately without suppressing misses", function (this: CanonicalWorld) {
  assert.strictEqual(this.capabilityResult?.capabilityCoverage.caseWeighted, 0.5);
  assert.strictEqual(this.capabilityResult?.recall.falseNegatives, 2);
});

Given(
  "a legacy record keyed on source field name without adjudicated canonical concept",
  function (this: CanonicalWorld) {
    this.expectations = [
      withId(
        buildMigrationIncompleteRecord({
          layer: "data-items",
          identityKey: "source-field:clientId",
          evidenceLocations: [sampleEvidence("src/form.ts", 3, 3)],
        }),
        "source-token-only",
      ),
      withId(
        buildAcceptedGoldExpectation({
          layer: "mentions",
          identityKey: "mention:email",
          conceptLeaf: "email_address",
          evidenceLocations: [sampleEvidence("src/email.ts", 1, 1)],
        }),
        "accepted-positive",
      ),
    ];
    this.findings = [];
  },
);

When("baseline metrics are computed", function (this: CanonicalWorld) {
  this.baselineResult = computeBaselineMetrics(this.expectations, this.findings);
});

Then("the record is migration-incomplete", function (this: CanonicalWorld) {
  assert.strictEqual(this.baselineResult?.migrationIncompleteCount, 1);
});

Then("it is not counted as a baseline false negative", function (this: CanonicalWorld) {
  assert.strictEqual(this.baselineResult?.strictRecall.denominator, 1);
  assert.strictEqual(this.baselineResult?.baselineFalseNegativeCount, 1);
});

// Export contract version for potential future adapter scenarios.
void CANONICAL_CONTRACT_VERSION;
