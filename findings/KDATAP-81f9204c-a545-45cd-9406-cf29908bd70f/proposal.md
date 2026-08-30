# Proposal

## Fixture or repository

`tests/fixtures/java-basic`

## What we expect to find

`CustomersController.java` line 31 posts to `https://api.stripe.com/v1/customers`. The deterministic scan should emit a Stripe third-party component and an `api_call` data flow from the section API asset to that third party, both anchored on that HTTP call.

Verified against `scan()` with AI inference off: `third_party:stripe` includes `CustomersController.java:31-31` (also the `RestTemplate` field at 21) and `flow:asset:api->third_party:stripe` (`api_call`) at line 31.

## Human review

Reviewed against fixture source and live scan output. Advanced off proposed after that check.
