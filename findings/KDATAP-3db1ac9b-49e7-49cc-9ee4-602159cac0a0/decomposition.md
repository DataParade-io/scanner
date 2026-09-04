# Decomposition

Eval cases: `py-psycopg2-database-gap` (components and data-flows).

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| components | `asset:psycopg2` | `app.py:7-7` | positive | database | yes |
| data-flows | `flow:asset:python-basic->asset:psycopg2` | `app.py:7-7` | positive | database_query | yes |

Personal-data layers do not apply.
