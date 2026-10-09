# UF4: Label endpoints with the project's vocabulary

**Notion ticket:** *(not requested)*

## Context

During or after fitting, the team wants the inventory to speak their language (for example `public`, `customer`, `back-office`) beside the closed Core Classification, so the inventory reads like their own access model.

## Specification

AAU (developer or auditor), at the dimension step of fitting, I see the Agent:
- propose one or more Project Dimensions with candidate values, inferred from what it found (prefixes, middleware, roles in rules, admin)
- show for each candidate value the endpoints it would cover
- ask me to confirm, rename, merge or reject each dimension and value
- write the confirmed dimensions and their assignment rules in `dimensions.py`
- declare the dimensions and allowed values at the top of `inventory.json` and assign one value per dimension to every endpoint

## Success Scenario

- AAU, the Agent proposes `access_tier` with `public`, `customer`, `back-office` based on `/api/` middleware and `/admin/`, I rename `back-office` to `staff`, and the inventory uses `staff`.
- AAU, I reject a proposed dimension, no dimension is written and the inventory has no `dimensions` field.

## Error Scenario

- AAU, an assignment rule leaves an endpoint without a value for a declared dimension, the script fails with the endpoint named, so the inventory is never partially labelled.

## Edge Cases

- AAU, if two assignment rules match one endpoint, the more specific path rule wins and the choice is recorded in `dimensions.py`.
- AAU, if I later add an endpoint that no rule covers, `--check` fails on the missing value, and I extend `dimensions.py` by hand or through update mode.
- AAU, if I assign a dimension value that contradicts the Core Classification (an `anonymous` endpoint labelled `staff`), the inventory records both, because the core states what is enforced and the dimension states what the team calls it.

## Acceptance Criteria

- [ ] The inventory declares each dimension with its allowed values and every endpoint carries exactly one value per dimension.
- [ ] A value outside the declared set fails schema validation.
- [ ] Confirming, renaming and rejecting a proposed dimension each produce the expected `dimensions.py`.
- [ ] Project Dimensions never alter the Core Classification fields.
