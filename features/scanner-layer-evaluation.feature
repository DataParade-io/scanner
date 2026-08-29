@layer-eval
Feature: Scanner layer evaluation

  Scenario: Data item identity recall
    Given the Subject Identity score is on the scorecard
    And a data-item gold dataset with a matching subjectKey
    When I run plexus evaluate accuracy for the Subject Identity score
    Then an Evaluation record is stored for layer evaluation
    And the headline metric is recall of detections at 100 percent

  Scenario: Data item identity miss
    Given the Subject Identity score is on the scorecard
    And a data-item gold dataset with a missing subjectKey
    When I run plexus evaluate accuracy for the Subject Identity score
    Then that Item counts as a miss for layer evaluation

  Scenario: Raw hit span recall
    Given the Raw Hit Span score is on the scorecard
    And a raw-hit gold dataset with an overlapping span
    When I run plexus evaluate accuracy for the Raw Hit Span score
    Then an Evaluation record is stored for layer evaluation
    And the headline metric is recall of detections at 100 percent

  Scenario: Mention span recall
    Given the Mention Span score is on the scorecard
    And a mention gold dataset with an overlapping span and subjectKey
    When I run plexus evaluate accuracy for the Mention Span score
    Then an Evaluation record is stored for layer evaluation
    And the headline metric is recall of detections at 100 percent
