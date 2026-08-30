# Proposal

## Fixture or repository

`tests/fixtures/terraform-basic`

## What we expect to find

`main.tf` lines 5–10 declare `resource "aws_db_instance" "main"` with `engine = "postgres"`. That is a managed PostgreSQL database and should surface as component `asset:main (aws_db_instance)` labeled `database`.

Verified against `scan()`: that key is present at `main.tf:5-10` with labels `asset`, `database`.

## Human review

Reviewed against fixture source and live scan output. Advanced off proposed after that check.
