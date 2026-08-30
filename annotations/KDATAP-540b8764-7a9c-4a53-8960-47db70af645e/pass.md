# Annotation pass

## Repository / fixture

`tests/fixtures/terraform-basic`

## Scope

Reviewed the Terraform fixture for component-graph and personal-data eval gold:

- `main.tf` — `aws_db_instance.main` resource and `aws_db_instance.main.address` in Lambda env
- `providers.tf`, `variables.tf` — scanned for completeness; no additional gold cases filed

Gold lives in `tests/eval/layers/components/cases.ts`, `tests/eval/layers/raw-hits/cases.ts`, `tests/eval/layers/mentions/cases.ts`, and `tests/eval/layers/data-items/cases.ts` under fixture id `terraform-basic`.

## Findings in this pass

- `KDATAP-5e03b82c-343e-4360-a87e-79cce895ab6e` — aws_db_instance is a database (`tf-aws-pg-database`)
- `KDATAP-db66b175-66b2-4989-b8de-c7c94e70001b` — `.address` is not a postal address (`raw-tf-address-not-profile`, `mention-tf-address-not-profile`, `data-item-tf-no-address`)

## Human review

This annotation stays in **awaiting-review** until a person moves it to **accepted**.
