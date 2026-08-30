# Annotation pass

## Repository / fixture

`tests/fixtures/terraform-basic`

## Scope

Reviewed the Terraform fixture for component-graph and personal-data eval gold:

- `main.tf` — `aws_db_instance.main`, Lambda `DATABASE_URL` from `.address`, and `bind_address` output
- `providers.tf`, `variables.tf` — scanned for completeness

Gold lives in `tests/eval/layers/*/cases.ts` under fixture id `terraform-basic`.

## Findings in this pass

- `KDATAP-5e03b82c-343e-4360-a87e-79cce895ab6e` — aws_db_instance is a database (`tf-aws-pg-database`)
- `KDATAP-e63b7c9c-3886-4b84-9432-f40d5239162f` — Lambda queries aws_db_instance (`tf-lambda-db-query-flow`)
- `KDATAP-db66b175-66b2-4989-b8de-c7c94e70001b` — `.address` / `bind_address` are not postal (`raw-tf-address-not-profile`, `raw-tf-bind-address-not-profile`, and mention/data-item counterparts)

## Human review

Accepted. Ryan accepted this labeling pass after live `scan()` / PII-matcher review.
