# Annotation pass

## Repository / fixture

`tests/fixtures/typescript-basic`

## Scope

Reviewed the full fixture tree for Jest eval gold across components, data-flows, raw-hits, mentions, and data-items:

- `external-api.ts` — Stripe `fetch` to `api.stripe.com`
- `db-client-import.ts` — `pg` module import for database asset detection
- `pg-client.ts` — pg client implementation referenced by import
- `server.ts` — `passport.authenticate('jwt')` local auth middleware
- `db.ts`, `app/route.ts` — scanned for completeness; no additional gold cases filed

Gold lives in `tests/eval/layers/*/cases.ts` under fixture id `typescript-basic`.

## Findings in this pass

- `KDATAP-190cb5bd-0eb8-48c9-9f8e-3b89b1df4948` — Stripe third-party API flow (`ts-stripe-third-party`, `ts-stripe-api-flow`)
- `KDATAP-6020104a-8e72-4159-8af5-103c8da29322` — pg database query flow (`ts-pg-database`, `ts-pg-database-flow`)
- `KDATAP-ff794471-42fd-4fa0-a1c8-ef98680c4f8c` — passport.authenticate is not PII or a vendor (`ts-passport-not-third-party`, `ts-passport-no-external-flow`, `raw-ts-passport-auth-not-number`, `mention-ts-passport-auth-not-number`, `data-item-ts-no-passport`)

## Human review

This annotation stays in **awaiting-review** until a person moves it to **accepted**.
