# Annotation pass — KDATAP-a7c36b

## Task

KDATAP-a7c36b — Slice-2 adjudication of remaining 273 data-flow gold rows.

Parent: KDATAP-182788. Follows applied slice KDATAP-47e331 (146 accept / 17 reject / 273 unresolved).

## Scope

273 corpus rows with `review_state: needs_adjudication` across 29 `data_flows.yaml` packets.

Evidence from pinned source spans (±5 lines) and `patterns/personal-data-concept-map.yaml` only. No `scan()` or detector output.

Does **not** touch 146 accepted / 17 rejected rows from KDATAP-47e331.

## Method

Option B (ledger-then-flip): ledger at `annotations/KDATAP-a7c36b/adjudication-ledger.json`.

Script: `tests/benchmark/scripts/adjudicate-flow-gold-slice2.ts`

Module: `tests/eval/canonical/compat/flow-adjudication-slice2.ts`

- Every accept requires ≥1 closed-map `data_categories` leaf from evidence span only
- Token/session/reset-token/CSRF/OpenID flows without a closed-map leaf → unresolved
- `--apply` writes `flow_canonical` via `buildFlowAnnotationCanonicalBlock` on every accept

## Disposition summary

| Disposition | Count |
| --- | ---: |
| accept | 12 |
| reject | 0 |
| unresolved | 261 |
| **Total** | **273** |

## Category corrections (closed-map leaves)

| id | before → after |
| --- | --- |
| directus-login-email-to-users-table | (none) → email_address |
| directus-local-get-user-id | (none) → email_address |
| drupal-reset-password-to-notification | (none) → password, email_address |
| ghost-stripe-customer-create | (none) → email_address |
| pocketbase-password-to-bcrypt-hash | (none) → password |
| pocketbase-hash-to-database | (none) → password |
| posthog-user-email-persisted | (none) → email_address |
| redmine-email-normalize-address | (none) → email_address |
| spree-address-to-customer-profile | (none) → phone_number, first_name, last_name |
| strapi-forgot-email-query | (none) → email_address |
| strapi-reset-email-send | (none) → email_address, username, first_name, last_name |
| wordpress-password-to-hash | (none) → password |

## Spot-check queue for Ryan (18 rows)

All contested accepts, category corrections, plus verified-but-unresolved samples.

| id | repo | disposition | reasons |
| --- | --- | --- | --- |
| auth0-express-callback-to-session | auth0-express | unresolved | verified-but-unresolved sample |
| auth0-express-cookie-to-session | auth0-express | unresolved | verified-but-unresolved sample |
| auth0-express-login-to-idp | auth0-express | unresolved | verified-but-unresolved sample |
| auth0-express-refresh-to-token-endpoint | auth0-express | unresolved | verified-but-unresolved sample |
| directus-local-get-user-id | directus | accept | contested accept; category correction |
| directus-local-router-to-auth-service | directus | unresolved | verified-but-unresolved sample |
| directus-login-email-to-users-table | directus | accept | contested accept; category correction |
| directus-login-to-sessions-table | directus | unresolved | verified-but-unresolved sample |
| drupal-reset-password-to-notification | drupal | accept | contested accept; category correction |
| ghost-stripe-customer-create | ghost | accept | contested accept; category correction |
| pocketbase-hash-to-database | pocketbase | accept | contested accept; category correction |
| pocketbase-password-to-bcrypt-hash | pocketbase | accept | contested accept; category correction |
| posthog-user-email-persisted | posthog-user | accept | contested accept; category correction |
| redmine-email-normalize-address | redmine | accept | contested accept; category correction |
| spree-address-to-customer-profile | spree | accept | contested accept; category correction |
| strapi-forgot-email-query | strapi | accept | contested accept; category correction |
| strapi-reset-email-send | strapi | accept | contested accept; category correction |
| wordpress-password-to-hash | wordpress | accept | contested accept; category correction |

## Human review

Accepted — Ryan Alyn Porter. Status: **packet-accepted**.

## Apply (KDATAP-a7c36b --apply)

Applied via `pnpm exec ts-node tests/benchmark/scripts/adjudicate-flow-gold-slice2.ts --apply`.

| Disposition | Count |
| --- | ---: |
| accept | 12 |
| reject | 0 |
| unresolved (`needs_adjudication`) | 261 |
| **Total** | **273** |

### Cumulative data-flow totals (after apply)

| Disposition | Count |
| --- | ---: |
| accept | 158 |
| reject | 17 |
| unresolved (`needs_adjudication`) | 261 |
| **Total** | **436** |

- 29 `data_flows.yaml` files updated (12 accepts with `flow_canonical` blocks).
- Kanbus: 12 findings → `accepted`; 261 remain `proposed`.
- `corpus-gold.digest`: `sha256:5f51893edc6210c9af8156393cd5f8055acb55f8335b7ed8dae45a991426e93b`
