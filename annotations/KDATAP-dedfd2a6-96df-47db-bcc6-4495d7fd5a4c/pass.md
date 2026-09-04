# Annotation pass

## Repository / fixture

`tests/fixtures/typescript-basic`

## Scope

Reviewed the full fixture tree for Jest eval gold across components, data-flows, raw-hits, mentions, and data-items:

- `external-api.ts` — Stripe `fetch` to `api.stripe.com`
- `db-client-import.ts` — `pg` module import for database asset detection
- `pg-client.ts` — pg client implementation referenced by import
- `server.ts` — `passport.authenticate('jwt')` and `passport_strategy` (not travel-document PII)
- `db.ts`, `app/route.ts` — scanned for completeness; no additional gold cases filed

Gold lives in `tests/eval/layers/*/cases.ts` under fixture id `typescript-basic`.

## Findings in this pass

- `KDATAP-190cb5bd-0eb8-48c9-9f8e-3b89b1df4948` — Stripe third-party API flow (`ts-stripe-third-party`, `ts-stripe-api-flow`)
- `KDATAP-6020104a-8e72-4159-8af5-103c8da29322` — pg database query flow (`ts-pg-database`, `ts-pg-database-flow`)
- `KDATAP-ff794471-42fd-4fa0-a1c8-ef98680c4f8c` — passport.authenticate / passport_strategy is not PII or a vendor (`ts-passport-not-third-party`, `ts-passport-no-external-flow`, `raw-ts-passport-auth-not-number`, `raw-ts-passport-strategy-not-number`, and mention/data-item counterparts)

## Human review

Accepted. Ryan accepted this labeling pass after live `scan()` / PII-matcher review.

## Exhaustive scope (precision)

Files in `tests/eval/exhaustive-scopes.ts` for this fixture are a closed world. Scanner findings in those files that do not match an accepted positive are false positives. We do not file a negative for vendors the repo does not use.
