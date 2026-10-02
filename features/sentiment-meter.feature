Feature: Coding-session sentiment meter
  As a developer running local AI coding sessions,
  I want a counts-only meter balancing gratitude against F-bombs,
  so that I can tell how a day of vibe coding is going without any
  message text ever leaving my machine.

  Scenario: Counting a thanks message
    Given a human message "thanks for the fix" in the last day
    When I compute the meter over the last-24h window
    Then the thanks count is 1
    And the F-bomb count is 0
    And the band is "mostly grateful"

  Scenario: Ignoring profanity in a code block
    Given a human message "look:\n```\nfuck\n```" in the last day
    When I compute the meter over the last-24h window
    Then the F-bomb count is 0

  Scenario: Ignoring a pasted log
    Given a human message that is a 2500-character pasted log containing an F-bomb
    When I compute the meter over the last-24h window
    Then the F-bomb count is 0
    And the message is excluded

  Scenario: Today with day-start 04:00 assigns a 03:59 message to yesterday
    Given a human message at 03:59 local time today with day-start 04:00
    When I compute the meter over the today window
    Then the thanks count is 0
    When I compute the meter over the yesterday window
    Then the thanks count is 1

  Scenario: A rolling last-24h window
    Given a human message 23 hours ago
    And a human message 25 hours ago
    When I compute the meter over the last-24h window
    Then the thanks count is 1

  Scenario: Deduplicating a forked session
    Given the same human message in a session and its forked copy
    When I compute the meter over the all window
    Then the thanks count is 1

  Scenario: Output contains counts only
    Given a human message "thanks for the secret phrase xyzzyspoon" in the last day
    When I format the meter as text
    Then the output contains "Thanks: 1"
    And the output does not contain "xyzzyspoon"
