# Proposal

## Fixture or repository

`tests/fixtures/jvm-manifests-basic`

## What we expect to find

Spring datasource `username` appears in two YAML files: `application.yml` line 6 (`username: billing_app`) and `bootstrap.yml` line 6 (`username: billing_backup`). Those should fire username raw-hits and mentions at each span and roll up to one `data_item:username`.

Verified against the personal-data collector: `raw_hit:username` and `mention:username` at both YAML lines; one `data_item:username` (identity-only match).

## Human review

Reviewed against fixture source and live scan output. Advanced off proposed after that check.
