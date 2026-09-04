# Proposal

## Fixture or repository

`tests/fixtures/python-basic`

## What we expect to find

`app.py` line 11 calls `requests.get("https://api.openai.com/v1/models")`. The scan should emit an OpenAI third-party component and an `api_call` data flow from the `python-basic` application asset to that third party, both on that HTTP line.

Verified against `scan()`: `third_party:openai` at `app.py:11-11` (labels `third_party`, `ai_provider`) and `flow:asset:python-basic->third_party:openai` (`api_call`) at the same span.

## Human review

Reviewed against fixture source and live scan output. Advanced off proposed after that check.
