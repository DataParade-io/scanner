# Annotation pass

## Repository / fixture

`tests/fixtures/python-basic`

## Scope

Reviewed `app.py` for Jest eval gold across components and data-flows:

- Line 7 — `psycopg2.connect("postgres://example")` database connection
- Line 11 — `requests.get("https://api.openai.com/v1/models")` OpenAI API call

Gold lives in `tests/eval/layers/components/cases.ts` and `tests/eval/layers/data-flows/cases.ts` under fixture id `python-basic`.

## Findings in this pass

- `KDATAP-b14a5693-47a6-4ded-8ea3-8ef1813a8f92` — OpenAI third-party API flow (`py-openai-third-party`, `py-openai-api-flow`)
- `KDATAP-3db1ac9b-49e7-49cc-9ee4-602159cac0a0` — psycopg2 database query, documented gap (`py-psycopg2-database-gap` at components and data-flows)
- `KDATAP-7f19294a-4c6a-4c36-9510-2164a86e3ffd` — OpenAI call is not Stripe (`py-stripe-not-openai-flow`)

## Human review

Accepted. Ryan accepted this labeling pass after live `scan()` / PII-matcher review.
