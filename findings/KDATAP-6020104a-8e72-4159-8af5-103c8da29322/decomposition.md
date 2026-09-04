# Decomposition

Eval cases: `ts-pg-database`, `ts-pg-database-flow`.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| components | `asset:pg` | `db-client-import.ts:1-1` | positive | database | no |
| data-flows | `flow:asset:root api->asset:pg` | `db-client-import.ts:1-1` | positive | database_query | no |

Personal-data layers do not apply.
