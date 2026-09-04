# Decomposition

Eval case: `tf-lambda-db-query-flow`.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| data-flows | `flow:asset:api (aws_lambda_function)->asset:main (aws_db_instance)` | `main.tf:21-32` | positive | database_query | no |

The database component is a separate finding. Personal-data layers do not apply (`.address` as non-postal is a separate finding).
