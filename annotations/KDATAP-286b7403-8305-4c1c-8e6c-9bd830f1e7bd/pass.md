# Annotation pass

## Repository / fixture

`tests/fixtures/java-basic`

## Scope

Reviewed the Java billing fixture for personal-data eval gold:

- `src/main/java/com/acme/billing/data/CustomerRepository.java` — `findByEmail(String email)` repository method
- `src/main/java/com/acme/billing/web/CustomersController.java` — scanned for completeness
- `src/main/java/com/acme/billing/config/DatabaseConfiguration.java` — scanned for completeness

Gold lives in `tests/eval/layers/raw-hits/cases.ts`, `tests/eval/layers/mentions/cases.ts`, and `tests/eval/layers/data-items/cases.ts` under fixture id `java-basic`.

## Findings in this pass

- `KDATAP-b01a0547-3a47-40f9-830f-148507e39fa3` — repository email parameter (`raw-java-email-parameter`, `mention-java-email-parameter`, `data-item-java-email`)

## Human review

This annotation stays in **awaiting-review** until a person moves it to **accepted**.
