# Decomposition

Eval cases: `java-stripe-third-party`, `java-stripe-api-flow`.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| components | `third_party:stripe` | `src/main/java/com/acme/billing/web/CustomersController.java:31-31` | positive | third_party | no |
| data-flows | `flow:asset:api->third_party:stripe` | `src/main/java/com/acme/billing/web/CustomersController.java:31-31` | positive | api_call | no |

Personal-data layers do not apply (email on the repository is a separate finding).
