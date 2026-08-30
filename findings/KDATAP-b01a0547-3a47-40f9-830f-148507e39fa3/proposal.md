# Proposal

## Fixture or repository

`tests/fixtures/java-basic`

## What we expect to find

`CustomerRepository.java` line 9 declares `Customer findByEmail(String email)`. The PII matcher (case-insensitive `\bemail\b`) should fire on that parameter and roll up through raw-hit, mention, and data-item grades with label `user_email`.

Verified against the personal-data collector: `raw_hit:email`, `mention:email`, and `data_item:email` all at `CustomerRepository.java:9-9`.

This fixture also contains an unfiled Stripe `fetch` in `CustomersController.java` line 31. That is a separate detection, not part of this finding.

## Human review

Reviewed against fixture source and live scan output. Advanced off proposed after that check.
