# Decomposition

Eval case: `tf-aws-pg-database`.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| components | `asset:main (aws_db_instance)` | `main.tf:5-10` | positive | database | no |

Data-flow and personal-data layers do not apply to this finding (the Lambda→DB flow is a separate unfiled detection).
