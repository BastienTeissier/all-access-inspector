# UF19: Capabilities named in the domain's words

**Notion ticket:** *(not requested)*

## Context

The Roles tab names a capability by its id (`action_tracking.emailwhitelistentry.change`) unless the vocabulary renames it. The Django admin already carries the words the project uses: a model's `verbose_name`, its plural, and an action's `short_description`. Per ADR 0005 these are read, never written: the Map Introspect extracts them, and the vocabulary keeps the last word with the glossary's terms.

## Specification

AAU (product manager), I open the Roles tab of a Django project and read every area and every capability of an unfolded area in words, not ids.

- an area is named after its model's plural verbose name ("Email whitelist entries"); its term stays the model's class name, linked to `models.py:<line>`
- an admin page capability is named after its action and the verbose name: "Add an email whitelist entry", "Change an email whitelist entry", "View email whitelist entries", "Delete an email whitelist entry"
- a custom admin action is named after its `short_description`, or its function name when there is none
- a vocabulary `extends` entry still wins: its `name` replaces the extracted one
- the extracted name is a runtime fact with basis `extracted`; the vocabulary's is `curated`

AAU (Agent in the map workflow), the map step ends when every capability of an unfolded area has a name that is not its id: `map check` lists the unnamed ones under "unnamed capabilities", and I rename them through the vocabulary with the glossary's terms, or fold their area.

## Success Scenario

- AAU, on `fixtures/django-demo`, I build the map and see "Orders" with "Add an order", "Change an order", "Ship selected orders"; `map check` prints "unnamed capabilities: none".
- AAU, on action-tracking, "Actions", "Action plans", "Email whitelist entries" and "Notification events" read in words; the two curated capabilities keep their vocabulary names.

## Error Scenario

- AAU, a verbose name the introspect cannot read (a lazy translation that raises outside a request) falls back to the id, and `map check` lists the capability as unnamed.

## Edge Cases

- AAU, a model with no explicit `verbose_name` is named from the class name as Django does ("Email whitelist entry").
- AAU, a folded area's capabilities keep their ids: they are hidden under the fold and never counted as unnamed.
- AAU, a curated capability (vocabulary `id` entry) is always named; it never appears under unnamed.

## Acceptance Criteria

- [ ] `runtime.json` carries `name` on every area and admin capability of `fixtures/django-demo`; the golden is updated.
- [ ] The Roles tab (static page and app) shows the extracted name, the vocabulary name when present, the id as a tooltip or secondary text.
- [ ] `map check` prints "unnamed capabilities: none" or lists each one with its area.
- [ ] The map workflow's completion criterion names this check.
