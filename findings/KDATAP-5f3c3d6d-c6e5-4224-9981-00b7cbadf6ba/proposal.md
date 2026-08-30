# Proposal

## Fixture or repository

`tests/fixtures/dotnet-manifests-basic`

## What we expect to find

`src/Api/appsettings.json` line 8 contains `Username=app` inside `ConnectionStrings.DefaultConnection`. The PII matcher is case-insensitive, so that token should fire username raw-hit, mention, and data-item grades.

Verified against the personal-data collector: `raw_hit:username`, `mention:username`, and `data_item:username` at `src/Api/appsettings.json:8-8`.

## Human review

Reviewed against fixture source and live scan output. Advanced off proposed after that check.
