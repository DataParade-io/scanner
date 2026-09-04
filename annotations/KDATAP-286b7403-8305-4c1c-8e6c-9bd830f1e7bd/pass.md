# Annotation pass

## Repository / fixture

`tests/fixtures/java-basic`

## Scope

Reviewed the Java billing fixture for personal-data and graph eval gold:

- `src/main/java/com/acme/billing/data/CustomerRepository.java` — `findByEmail(String email)` repository method
- `src/main/java/com/acme/billing/web/CustomersController.java` — Stripe `postForObject` to `api.stripe.com`
- `src/main/java/com/acme/billing/config/DatabaseConfiguration.java` — scanned for completeness

Gold lives in `tests/eval/layers/*/cases.ts` under fixture id `java-basic`.

## Findings in this pass

- `KDATAP-b01a0547-3a47-40f9-830f-148507e39fa3` — repository email parameter (`raw-java-email-parameter`, `mention-java-email-parameter`, `data-item-java-email`)
- `KDATAP-81f9204c-a545-45cd-9406-cf29908bd70f` — Stripe third-party API flow (`java-stripe-third-party`, `java-stripe-api-flow`)

## Human review

Accepted. Ryan accepted this labeling pass after live `scan()` / PII-matcher review.

## Exhaustive scope (precision)

The three Java sources are a closed world. Accepted positives include the email parameter, Stripe call, JDBC PostgreSQL, and Spring Data JPA. Extra scanner hits in these files lower precision.
