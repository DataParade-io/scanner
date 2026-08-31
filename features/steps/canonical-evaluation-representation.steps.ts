import { Given, Then, When } from "@cucumber/cucumber";

const pending = (): "pending" => "pending";

// KDATAP-b18135 — issue scenarios

Given("canonical gold and a scanner finding for the same evidence", pending);
When("each passes through its adapter", pending);
Then("both carry the same contract version", pending);
Then(
  "entity identity, asserted classification, optional vendor and evidence are separate fields",
  pending,
);

Given("an expectation whose canonical identity does not match a finding", pending);
When("a display name or observed-token candidate happens to match", pending);
Then("the observations do not match", pending);

Given("an asset expectation asserting type and subtype but no instance", pending);
When("a finding matches the asserted fields and evidence", pending);
Then("strict correctness does not require the legacy display name", pending);

Given("two database component expectations in one repository", pending);
When(
  "both share a taxonomy subtype but have distinct canonical entities or evidence",
  pending,
);
Then("one finding cannot satisfy both expectations", pending);

Given("an expectation whose concept leaf is driver licence", pending);
When("a finding carries only the national-identifier ancestor", pending);
Then("exact-leaf correctness is not credited", pending);
Then("ancestor-category correctness is reported separately", pending);

// KDATAP-95cfe1 — legacy name per layer

Given("a mention expectation with a legacy subject name", pending);
Given(
  "a data item consolidated from multiple evidence locations with alternate spellings",
  pending,
);
Given(
  "a data item with contradictory observed tokens such as pii:email_address and clientID",
  pending,
);
Given("an asset expectation with a legacy code-level subject name", pending);
Given("a third-party expectation with a legacy vendor subject name", pending);
Given("a data-flow expectation with a legacy prose subject name", pending);
When("the gold adapter normalizes the expectation", pending);
Then(
  "the legacy name is an evidence-linked observed token candidate on that occurrence",
  pending,
);
Then("the legacy name is not promoted to authoritative source identity", pending);
Then("every evidence-linked observed token is preserved with provenance", pending);
Then("no single arbitrary spelling replaces the collection", pending);
Then("the contradictory values are retained with validation state", pending);
Then("the record requires adjudication rather than automatic acceptance", pending);
Then("the legacy name is preserved as observed code or display evidence", pending);
Then("it is not treated as a required canonical instance", pending);
Then(
  "the legacy name is a vendor candidate cross-checked against the asserted vendor",
  pending,
);
Then("a mismatch requires adjudication", pending);
Then("the legacy name is retained as legacy display and migration provenance", pending);
Then("it is not an endpoint or semantic matching field", pending);

// KDATAP-00e64a — instance/vendor

Given("a component expectation asserting only type and subtype", pending);
When("a finding matches every asserted field and evidence", pending);
Then("strict correctness succeeds", pending);
Then("unasserted schema fields are not required", pending);

Given("an asset expectation asserting type and subtype without instance", pending);
When("a finding matches the asserted type subtype and evidence", pending);

Given("a third-party expectation with an asserted vendor", pending);
When("a finding matches type and subtype but not the asserted vendor", pending);
Then("strict correctness fails", pending);

Given(
  "accepted canonical expectations including vendor-asserting and subtype-only components",
  pending,
);
When("vendor-resolution metrics are computed", pending);
Then("the denominator includes only records that assert a vendor", pending);
Then("subtype-only records do not dilute vendor metrics", pending);

Given("two same-subtype component expectations with distinct canonical entities", pending);
When("strict matching is evaluated", pending);
Then("optional instance is not invented to satisfy both expectations", pending);

// KDATAP-471fdc — component entity identity and cardinality

Given("a canonical gold component expectation", pending);
When("a scanner finding is produced for the same repository", pending);
Then("the gold entity id is present on the expectation", pending);
Then("the scanner finding does not emit the gold entity id", pending);

Given("multiple component annotation rows referring to the same graph node", pending);
When("expectations are normalized for evaluation", pending);
Then("repository-entity consolidation happens before one-to-one assignment", pending);

Given(
  "two component expectations with the same subtype and distinct canonical entities",
  pending,
);
Then("both entities remain distinct", pending);

Given("a consolidated component entity with multiple evidence locations", pending);
When("evaluation results are produced", pending);
Then("entity recall is scored once", pending);
Then("evidence-location coverage is reported separately", pending);

Given("component annotation rows with the same subtype and ambiguous graph grouping", pending);
Then("the grouping is marked needs_adjudication", pending);
Then("no arbitrary consolidation is applied", pending);

Given("two indistinguishable same-subtype component expectations", pending);
When("one-to-one assignment is evaluated", pending);
Then("the evaluator does not guess which expectation a finding satisfies", pending);

// KDATAP-32c089 — flow disposition

Given("a legacy accepted data-flow annotation", pending);
When("migration normalization begins", pending);
Then("the row disposition is needs_adjudication", pending);
Then("no compatibility alias keeps it accepted", pending);

Given("a legacy data-flow expectation with prose display text", pending);
Then("the display text is isolated from endpoint identity", pending);
Then("matching uses asserted canonical endpoints only", pending);

// KDATAP-4d9b30 — capability coverage diagnostic

Given(
  "an accepted canonical evaluable positive with no declared detector support",
  pending,
);
When("strict recall is computed", pending);
Then("the case counts as a false negative", pending);
Then("declaredCapabilitySupported is false with reason", pending);

Given(
  "accepted canonical evaluable positives with mixed declared capability support",
  pending,
);
When("recall and capability coverage are computed", pending);
Then("recall uses the full accepted canonical evaluable denominator", pending);
Then("capability coverage is reported separately without suppressing misses", pending);

Given(
  "a legacy record keyed on source field name without adjudicated canonical concept",
  pending,
);
When("baseline metrics are computed", pending);
Then("the record is migration-incomplete", pending);
Then("it is not counted as a baseline false negative", pending);
