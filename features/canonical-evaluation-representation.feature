@canonical-ir-spec
Feature: Canonical evaluation representation

  # Source: KDATAP-b18135
  Scenario: Gold and scanner findings meet in one representation
    Given canonical gold and a scanner finding for the same evidence
    When each passes through its adapter
    Then both carry the same contract version
    And entity identity, asserted classification, optional vendor and evidence are separate fields

  # Source: KDATAP-b18135
  Scenario: Legacy observed text cannot rescue a mismatch
    Given an expectation whose canonical identity does not match a finding
    When a display name or observed-token candidate happens to match
    Then the observations do not match

  # Source: KDATAP-b18135
  Scenario: Strict correctness uses asserted fields only
    Given an asset expectation asserting type and subtype but no instance
    When a finding matches the asserted fields and evidence
    Then strict correctness does not require the legacy display name

  # Source: KDATAP-b18135
  Scenario: Same-subtype components retain cardinality
    Given two database component expectations in one repository
    When both share a taxonomy subtype but have distinct canonical entities or evidence
    Then one finding cannot satisfy both expectations

  # Source: KDATAP-b18135
  Scenario: An ancestor concept is not an exact match
    Given an expectation whose concept leaf is driver licence
    When a finding carries only the national-identifier ancestor
    Then exact-leaf correctness is not credited
    And ancestor-category correctness is reported separately

  # Source: KDATAP-95cfe1
  Scenario: Mention legacy name is preserved as an observed token candidate
    Given a mention expectation with a legacy subject name
    When the gold adapter normalizes the expectation
    Then the legacy name is an evidence-linked observed token candidate on that occurrence
    And the legacy name is not promoted to authoritative source identity

  # Source: KDATAP-95cfe1
  Scenario: Consolidated data item preserves every evidence-linked observed token
    Given a data item consolidated from multiple evidence locations with alternate spellings
    When the gold adapter normalizes the expectation
    Then every evidence-linked observed token is preserved with provenance
    And no single arbitrary spelling replaces the collection

  # Source: KDATAP-95cfe1
  Scenario: Contradictory observed tokens require adjudication
    Given a data item with contradictory observed tokens such as pii:email_address and clientID
    When the gold adapter normalizes the expectation
    Then the contradictory values are retained with validation state
    And the record requires adjudication rather than automatic acceptance

  # Source: KDATAP-95cfe1
  Scenario: Asset display name is evidence not asserted instance
    Given an asset expectation with a legacy code-level subject name
    When the gold adapter normalizes the expectation
    Then the legacy name is preserved as observed code or display evidence
    And it is not treated as a required canonical instance

  # Source: KDATAP-95cfe1
  Scenario: Third-party legacy name is a vendor candidate validated against asserted vendor
    Given a third-party expectation with a legacy vendor subject name
    When the gold adapter normalizes the expectation
    Then the legacy name is a vendor candidate cross-checked against the asserted vendor
    And a mismatch requires adjudication

  # Source: KDATAP-95cfe1
  Scenario: Flow legacy name is migration provenance only
    Given a data-flow expectation with a legacy prose subject name
    When the gold adapter normalizes the expectation
    Then the legacy name is retained as legacy display and migration provenance
    And it is not an endpoint or semantic matching field

  # Source: KDATAP-00e64a
  Scenario: Strict success requires only fields gold asserts
    Given a component expectation asserting only type and subtype
    When a finding matches every asserted field and evidence
    Then strict correctness succeeds
    And unasserted schema fields are not required

  # Source: KDATAP-00e64a
  Scenario: Subtype-only asset expectation does not require legacy display name
    Given an asset expectation asserting type and subtype without instance
    When a finding matches the asserted type subtype and evidence
    Then strict correctness does not require the legacy display name

  # Source: KDATAP-00e64a
  Scenario: Asserted third-party vendor is required for strict match
    Given a third-party expectation with an asserted vendor
    When a finding matches type and subtype but not the asserted vendor
    Then strict correctness fails

  # Source: KDATAP-00e64a
  Scenario: Vendor-resolution metrics use a vendor-asserting denominator
    Given accepted canonical expectations including vendor-asserting and subtype-only components
    When vendor-resolution metrics are computed
    Then the denominator includes only records that assert a vendor
    And subtype-only records do not dilute vendor metrics

  # Source: KDATAP-00e64a
  Scenario: Optional instance is not used to distinguish same-subtype entities
    Given two same-subtype component expectations with distinct canonical entities
    When strict matching is evaluated
    Then optional instance is not invented to satisfy both expectations

  # Source: KDATAP-471fdc
  Scenario: Gold entity id is migration bookkeeping not a scanner field
    Given a canonical gold component expectation
    When a scanner finding is produced for the same repository
    Then the gold entity id is present on the expectation
    And the scanner finding does not emit the gold entity id

  # Source: KDATAP-471fdc
  Scenario: Repository entities consolidate before one-to-one assignment
    Given multiple component annotation rows referring to the same graph node
    When expectations are normalized for evaluation
    Then repository-entity consolidation happens before one-to-one assignment

  # Source: KDATAP-471fdc
  Scenario: Distinct same-subtype entities are not collapsed
    Given two component expectations with the same subtype and distinct canonical entities
    When expectations are normalized for evaluation
    Then both entities remain distinct
    And one finding cannot satisfy both expectations

  # Source: KDATAP-471fdc
  Scenario: Evidence-location coverage is reported separately from entity recall
    Given a consolidated component entity with multiple evidence locations
    When evaluation results are produced
    Then entity recall is scored once
    And evidence-location coverage is reported separately

  # Source: KDATAP-471fdc
  Scenario: Ambiguous same-subtype grouping is needs_adjudication
    Given component annotation rows with the same subtype and ambiguous graph grouping
    When expectations are normalized for evaluation
    Then the grouping is marked needs_adjudication
    And no arbitrary consolidation is applied

  # Source: KDATAP-471fdc
  Scenario: Assignment does not guess between indistinguishable same-subtype entities
    Given two indistinguishable same-subtype component expectations
    When one-to-one assignment is evaluated
    Then the evaluator does not guess which expectation a finding satisfies

  # Source: KDATAP-32c089
  Scenario: Legacy accepted flow rows start as needs_adjudication
    Given a legacy accepted data-flow annotation
    When migration normalization begins
    Then the row disposition is needs_adjudication
    And no compatibility alias keeps it accepted

  # Source: KDATAP-32c089
  Scenario: Flow display text is not an endpoint identity field
    Given a legacy data-flow expectation with prose display text
    When the gold adapter normalizes the expectation
    Then the display text is isolated from endpoint identity
    And matching uses asserted canonical endpoints only

  # Source: KDATAP-4d9b30
  Scenario: Declared capability unsupported is still a strict false negative
    Given an accepted canonical evaluable positive with no declared detector support
    When strict recall is computed
    Then the case counts as a false negative
    And declaredCapabilitySupported is false with reason

  # Source: KDATAP-4d9b30
  Scenario: Capability coverage does not change the recall denominator
    Given accepted canonical evaluable positives with mixed declared capability support
    When recall and capability coverage are computed
    Then recall uses the full accepted canonical evaluable denominator
    And capability coverage is reported separately without suppressing misses

  # Source: KDATAP-4d9b30
  Scenario: Source-token-only legacy rows are migration-incomplete not baseline false negatives
    Given a legacy record keyed on source field name without adjudicated canonical concept
    When baseline metrics are computed
    Then the record is migration-incomplete
    And it is not counted as a baseline false negative
