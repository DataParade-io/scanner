# Decomposition

Eval cases: `py-openai-third-party`, `py-openai-api-flow`.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| components | `third_party:openai` | `app.py:11-11` | positive | third_party | no |
| data-flows | `flow:asset:python-basic->third_party:openai` | `app.py:11-11` | positive | api_call | no |

Personal-data layers do not apply.
