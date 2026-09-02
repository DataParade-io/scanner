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

  Scenario: Data item identity-only evidence
    Given the Subject Identity score is on the scorecard
    And a data-item gold dataset with identity-only evidence
    When I run plexus evaluate accuracy for the Subject Identity score
    Then an Evaluation record is stored for layer evaluation
    And the headline metric is recall of detections at 100 percent

  Scenario: Data item multi-file rollup
    Given the Subject Identity score is on the scorecard
    And a data-item gold dataset with a multi-file subjectKey
    When I run plexus evaluate accuracy for the Subject Identity score
    Then an Evaluation record is stored for layer evaluation
    And the headline metric is recall of detections at 100 percent

  Scenario: Raw hit identity recall
    Given the Raw Hit Identity score is on the scorecard
    And a raw-hit gold dataset with a matching subjectKey
    When I run plexus evaluate accuracy for the Raw Hit Identity score
    Then an Evaluation record is stored for layer evaluation
    And the headline metric is recall of detections at 100 percent

  Scenario: Raw hit identity miss
    Given the Raw Hit Identity score is on the scorecard
    And a raw-hit gold dataset with a missing subjectKey
    When I run plexus evaluate accuracy for the Raw Hit Identity score
    Then that Item counts as a miss for layer evaluation

  Scenario: Mention identity recall
    Given the Mention Identity score is on the scorecard
    And a mention gold dataset with a matching subjectKey
    When I run plexus evaluate accuracy for the Mention Identity score
    Then an Evaluation record is stored for layer evaluation
    And the headline metric is recall of detections at 100 percent

  Scenario: Mention identity miss
    Given the Mention Identity score is on the scorecard
    And a mention gold dataset with a missing subjectKey
    When I run plexus evaluate accuracy for the Mention Identity score
    Then that Item counts as a miss for layer evaluation

  Scenario: Unread file is omitted from identity recall
    Given the Raw Hit Identity score is on the scorecard
    And a raw-hit identity gold Item whose evidence file was not ingested
    When I run plexus evaluate accuracy for the Raw Hit Identity score
    Then that Item is not counted as a No for layer evaluation
    And that Item is not in the recall denominator for layer evaluation

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

  Scenario: Unread file is omitted from layer recall
    Given the Raw Hit Span score is on the scorecard
    And a gold Item whose evidence file the layer scanner did not ingest
    When I run plexus evaluate accuracy for the Raw Hit Span score
    Then that Item is not counted as a No for layer evaluation
    And that Item is not in the recall denominator for layer evaluation

  Scenario: Ingested miss still counts for layer recall
    Given the Raw Hit Span score is on the scorecard
    And a gold Item whose evidence file the layer scanner ingested
    And no matching subject identity finding
    When I run plexus evaluate accuracy for the Raw Hit Span score
    Then that Item counts as a miss for layer evaluation
