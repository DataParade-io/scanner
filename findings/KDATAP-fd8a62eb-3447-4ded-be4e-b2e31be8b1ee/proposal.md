# Proposal

## Fixture or repository

`tests/fixtures/jvm-manifests-basic`

## What we expect to find

`application.yml` line 7 sets `password: super-secret-value`. The PII matcher should fire the password rule (`\bpassword\b`, among others) on that line and roll up through raw-hit, mention, and data-item grades with label `user_password`.

Verified against the personal-data collector: `raw_hit:password`, `mention:password`, and `data_item:password` at `application.yml:7-7`.

## Human review

Reviewed against fixture source and live scan output. Advanced off proposed after that check.
