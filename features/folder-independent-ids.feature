@stable-ids
Feature: Component ids do not depend on the scan folder

  DataParade compares scans of two Git revisions by component id (Jira DATAP-841).
  A scan of a repository without a configured project name names the root
  Application component after the scanned folder. That name is for display only:
  the same code scanned from two differently named folders must give the same ids.

  # Source: KDATAP-296090
  Scenario: The same code scanned from two differently named folders gets the same component ids
    Given the folder-independent-ids fixture copied into a folder named "first-checkout"
    And the folder-independent-ids fixture copied into a folder named "second-checkout"
    When both copies are scanned without a project name
    Then both scans have the same component ids
    And the root Application component is named after its own folder in each scan
