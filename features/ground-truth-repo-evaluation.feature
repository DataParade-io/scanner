Feature: Ground-truth repository evaluation

  Executable specs that run the scanner against pinned GitHub corpus
  packets (Jira DATAP-602 / KDATAP-65ea65). Live scans need a local
  materialization; the corpus-declaration scenarios do not.

  Scenario Outline: Corpus names a GitHub repo known to track SSNs
    Given the "<repo>" benchmark packet
    Then its manifest pins "<github>"
    And accepted gold includes a social_security_number data item

    Examples:
      | repo        | github                                        |
      | easy-school | ZeroCoolHacker/easy-school                    |
      | vgs-django  | vgs-samples/vgs-django-sample-id-verification |

  @requires-materialized-corpus
  Scenario Outline: Known SSN repositories yield an SSN data item
    Given the pinned "<repo>" repository known to track SSNs
    When I run the scanner data-items evaluation layer
    Then I should get an SSN data item

    Examples:
      | repo        |
      | easy-school |
      | vgs-django  |

  @requires-materialized-corpus
  Scenario: Accepted gold SSN on easy-school is recalled
    Given the pinned "easy-school" repository known to track SSNs
    And accepted gold for easy-school-guardian-ssn
    When I score the data-items layer against the scan
    Then the SSN case is a match
