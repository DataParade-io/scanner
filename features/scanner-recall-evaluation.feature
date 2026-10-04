Feature: Scanner recall evaluation

  @requires-primus
  Scenario: Evaluate gold detections
    Given a local Primus GraphQL process with file storage
    And gold annotations loaded as Items labeled Yes
    And the detector Score is on the scorecard
    When I run primus evaluate accuracy for that score
    Then an Evaluation record is stored
    And the headline metric is recall of detections

  @requires-primus
  Scenario: Unread file is omitted from recall
    Given a gold Item whose evidence file the scanner did not ingest
    When I run primus evaluate accuracy
    Then that Item is not counted as a No
    And that Item is not in the recall denominator

  @requires-primus
  Scenario: Ingested miss still counts
    Given a gold Item whose evidence file the scanner ingested
    And no overlapping finding
    When I run primus evaluate accuracy
    Then that Item counts as a miss
