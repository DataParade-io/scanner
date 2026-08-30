# Proposal

## Fixture or repository

`tests/fixtures/terraform-basic`

## What we expect to find

`aws_lambda_function.api` (`main.tf` 21–32) sets `DATABASE_URL` from `aws_db_instance.main.address`. That wiring should surface a `database_query` data flow from the Lambda asset to the managed Postgres asset.

Verified against `scan()`: `flow:asset:api (aws_lambda_function)->asset:main (aws_db_instance)` (`database_query`) at `main.tf:21-32`. The DB component itself is finding `KDATAP-5e03b82c-343e-4360-a87e-79cce895ab6e`.

## Human review

Reviewed against fixture source and live scan output. Advanced off proposed after that check.
