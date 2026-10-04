Feature: Gold annotations as Primus Items

  Scenario: One annotation becomes one Item
    Given a canonical gold annotation in git YAML
    And a local Primus GraphQL server
    When I import that annotation
    Then a Primus Item exists with ground truth Yes
    And the Item identifies the same repository, commit, file, and line span
    And only the proposed positive annotation is imported as an Item

  Scenario: Git YAML remains canonical
    Given an annotation that changes in git YAML
    When I import again
    Then the Primus Item matches the git annotation
    And git YAML is still the source of truth
