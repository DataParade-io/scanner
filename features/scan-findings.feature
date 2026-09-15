Feature: Scanner discoveries for a detector Score

  # Discovery = scanner output / code evidence. Finding is reserved for OCSF-ish events.

  Scenario: A materialized tree yields file and line discoveries
    Given a tiny source tree on disk
    When I request scanner discoveries for that tree
    Then the results include a discovery with a file path and line span
