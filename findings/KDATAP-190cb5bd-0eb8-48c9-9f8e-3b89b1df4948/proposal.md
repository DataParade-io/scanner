# Proposal

## Fixture or repository

`tests/fixtures/typescript-basic`

## What we expect to find

`external-api.ts` line 6 calls `fetch("https://api.stripe.com/v1/customers", …)`. The deterministic scan should emit a Stripe third-party component and an `api_call` data flow from the section API asset to that third party, both anchored on that fetch line.

Verified against `scan()` with AI inference off: `third_party:stripe` at `external-api.ts:6-6` (labels `third_party`, `payment_processor`) and `flow:asset:api->third_party:stripe` (`api_call`) at the same span.

## Human review

Reviewed against fixture source and live scan output. Advanced off proposed after that check.
