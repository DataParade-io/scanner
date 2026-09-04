# Decomposition

Eval cases: `ts-stripe-third-party`, `ts-stripe-api-flow`.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| components | `third_party:stripe` | `external-api.ts:6-6` | positive | third_party | no |
| data-flows | `flow:asset:api->third_party:stripe` | `external-api.ts:6-6` | positive | api_call | no |

Personal-data layers do not apply (no Stripe PII gold on this detection).
