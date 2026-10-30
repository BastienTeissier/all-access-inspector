# Access map scenarios (Phase 9)

Scenarios for UF16 and UF17, run on `fixtures/django-demo`. Each scenario is one test in `map/tests/cli.spec.ts`, except "The map runtime is byte-stable", which is `test_map_golden` in `fixtures/django-demo/tests/`.

```gherkin
Feature: The access map
  As a security reviewer
  I want to see per Role and per Capability whether the role passes
  So that a change in who can do what fails CI until a human decides it

  Background:
    Given the project "django-demo" has a Committed Inventory
    And its Map Runtime and Map Vocabulary are committed

  Scenario: The map runtime is byte-stable
    When the developer runs the Map Introspect twice from two directories
    Then both runs write the same bytes as the expected runtime

  Scenario: Only the roles the code defines are shown
    When the developer builds the access map
    Then the roles are "anonymous", "clerk", "manager" and "superuser" in this order

  Scenario: A role reaching some endpoints of a capability is partial
    When the developer builds the access map
    Then the cell "Export orders" for "clerk" is "partial"
    And the alerts list it as a partial capability with no decision

  Scenario: An undecided partial capability fails the check
    When the developer runs map check
    Then map check exits 1
    And the output names "Export orders" for "clerk"

  Scenario: A decided partial capability passes the check
    Given the reviewer decided "Export orders" for "clerk" as "accepted" with the reason "Clerks export through a manager"
    When the developer runs map check
    Then map check exits 0

  Scenario: A decision goes outdated when the cell changes
    Given the reviewer decided "Export orders" for "clerk" as "accepted" with the reason "Clerks export through a manager"
    And the export endpoint now checks the permission the list checks
    When the developer runs map check
    Then map check exits 1
    And the output says the decision on "Export orders" for "clerk" is outdated

  Scenario: A decision without a reason is refused
    When the reviewer decides "Export orders" for "clerk" as "safe" with no reason
    Then map decide exits 2
    And the Review Log is unchanged

  Scenario: A decision on an unknown role is refused
    When the reviewer decides "Export orders" for "cashier" as "safe" with the reason "No such role"
    Then map decide exits 2
    And the output names "cashier"

  Scenario: A moved line fails the check
    Given the line a vocabulary entry cites has moved
    When the developer runs map check
    Then map check exits 1
    And the output says where the line moved

  Scenario: A vocabulary entry that duplicates a Map Rule fails the check
    Given the vocabulary writes the role "manager" by hand
    When the developer runs map check
    Then map check exits 1
    And the output names the Map Rule that already produces "manager"

  Scenario: A runtime that no longer matches the inventory fails the check
    Given the runtime lists an endpoint the inventory does not
    When the developer runs map check
    Then map check exits 1
    And the output names that endpoint

  Scenario: An invalid vocabulary is an error
    Given the vocabulary gives the role "auditor" the kind "admin"
    When the developer runs map check
    Then map check exits 2
    And the output names the field "kind"
```
