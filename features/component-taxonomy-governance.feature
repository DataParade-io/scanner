@component-taxonomy
Feature: Component taxonomy governs detector and annotation subtypes

  # Source: KDATAP-0c4ab5
  Scenario: Detector does not emit an undeclared subtype
    Given a scanner pipeline that would classify a component with subtype "not_in_taxonomy"
    When the classifier phase completes
    Then the emitted component has no subtype
    And the subtype is not "not_in_taxonomy"

  # Source: KDATAP-0c4ab5
  Scenario: Detector emits only declared taxonomy subtypes
    Given the typescript-basic fixture is scanned
    When components are collected from the classifier phase
    Then every emitted subtype is declared in component-taxonomy.yaml for its type

  # Source: KDATAP-0c4ab5
  Scenario: Evaluation identity fields come from the taxonomy
    Given the typescript-basic fixture is scanned
    When the evaluation harness adapts each component to a canonical finding
    Then type and subtype are taxonomy ids where subtype is present
    And instance is not required for asset findings
    And a component with no subtype is reported as a taxonomy gap rather than a match

  # Source: KDATAP-0c4ab5
  Scenario: Annotator subtypes exist in the taxonomy
    Given accepted component annotation labels in the benchmark corpus
    Then every label is a declared taxonomy subtype id
