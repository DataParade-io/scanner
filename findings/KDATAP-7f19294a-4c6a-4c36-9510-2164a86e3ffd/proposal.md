# Proposal

## Fixture or repository

`tests/fixtures/python-basic`

## What we expect to find

The HTTP call at `app.py` line 11 goes to `api.openai.com`, not Stripe. The scanner must not emit `flow:asset:python-basic->third_party:stripe` on that line.

Verified against `scan()`: the only third-party flow from that line is OpenAI. No Stripe component or Stripe flow is present in this fixture.

## Human review

Reviewed against fixture source and live scan output. Advanced off proposed after that check.
