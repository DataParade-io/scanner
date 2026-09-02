# Annotation pass — KDATAP-6b1c67

## Task

KDATAP-6b1c67 — Slice-2 adjudication of remaining 247 data-item gold rows.

Parent: KDATAP-182788. Follows applied slice KDATAP-25b2f4 (113 accept / 76 reject / 247 unresolved).

## Scope

247 corpus rows with `review_state: needs_adjudication` across 29 `data_items.yaml` packets.

Evidence from pinned source spans (±5 lines) and `patterns/personal-data-concept-map.yaml` only. No `scan()` or detector output.

## Method

Option B (ledger-then-flip): writes `annotations/KDATAP-6b1c67/adjudication-ledger.json` only. YAML `review_state` is **not** updated until Ryan accepts the packet and a later `--apply` run.

Script: `tests/benchmark/scripts/adjudicate-data-item-gold-slice2.ts`

Module: `tests/eval/canonical/compat/data-item-adjudication-slice2.ts`

- Per-row accept / reject / unresolved from closed map + source only
- **No accept ceiling** — no quota pressure on dispositions
- Hard fail on cache miss or invented leaf
- Does not touch 113 accepted / 76 rejected rows from KDATAP-25b2f4

## Disposition summary

| Disposition | Count |
| --- | ---: |
| accept | 27 |
| reject | 43 |
| unresolved | 177 |
| **Total** | **247** |

### By source bucket

| Bucket | Accept | Reject | Unresolved |
| --- | ---: | ---: | ---: |
| ambiguous | 2 | 12 | 38 |
| negative_adjudication | 0 | 6 | 0 |
| tier_c_category_unmapped | 25 | 15 | 106 |
| tier_e_never_auto_map | 0 | 10 | 33 |

## Label corrections (25)

Applied in ledger only; YAML updated on `--apply`.

| id | before → after | leaf |
| --- | --- | --- |
| directus-user-password | password_verifier → password | password |
| directus-share-password | credential_secret → password | password |
| discourse-sso-external-username | user_identifier → username | username |
| drupal-pass | password_verifier → password | password |
| drupal-login-pass-credential | credential_secret → password | password |
| drupal-http-login-pass | credential_secret → password | password |
| ghost-staff-password-item | password_verifier → password | password |
| ghost-staff-user-password | password_verifier → password | password |
| gitea-username | user_identifier → username | username |
| magento-customer-firstname | person_name → first_name | first_name |
| magento-customer-lastname | person_name → last_name | last_name |
| magento-address-firstname | person_name → first_name | first_name |
| magento-address-lastname | person_name → last_name | last_name |
| nopcommerce-customer-first-name | person_name → first_name | first_name |
| nopcommerce-customer-last-name | person_name → last_name | last_name |
| redmine-user-firstname | person_name → first_name | first_name |
| redmine-user-lastname | person_name → last_name | last_name |
| spree-address-firstname | person_name → first_name | first_name |
| spree-address-lastname | person_name → last_name | last_name |
| spring-petclinic-owner-first-name | person_name → first_name | first_name |
| spring-petclinic-owner-last-name | person_name → last_name | last_name |
| strapi-user-firstname | person_name → first_name | first_name |
| strapi-user-lastname | person_name → last_name | last_name |
| strapi-user-password | password_verifier → password | password |
| wordpress-user-pass | password_verifier → password | password |

## GLM advisory review

Advisory pass on contested accepts, label corrections, negative flips, and borderline rejects.

### Send-back fix (manager review)

Removed slice-2 branch that mapped `refresh_token` / `access_token` / `token` / `auth_token` + label `credential_secret` to closed-map leaf `password`. The concept map has `password` only — no `credential_secret`, refresh-token, or session-token leaf. Stuffing OAuth/session secrets into `password` invented a leaf.

| id | before | after | rationale |
| --- | --- | --- | --- |
| auth0-express-refresh-token-item | accept (password) | **unresolved** | No closed-map leaf for refresh/session token; cannot remap credential_secret to password. |
| directus-session-token | accept (password) | **unresolved** | No closed-map leaf for refresh/session token; cannot remap credential_secret to password. |
| supabase-js-refresh-token-item | accept (password) | **unresolved** | No closed-map leaf for refresh/session token; cannot remap credential_secret to password. |

| Finding | Action | Rationale |
| --- | --- | --- |
| Plaintext password accepts | **Keep accept** | Hash/verifier rows rejected; plaintext `password`/`pass`/`user_pass` fields accepted with `password_verifier` → `password` corrections where source confirms plaintext storage. |
| firstname/lastname alias accepts | **Keep accept** | Evidence-alias mapping to `first_name`/`last_name` leaves with verified source spans. |
| `discourse-sso-external-username` | **Keep accept** | `external_username` maps to closed `username` leaf with verified source span. |
| Verified-but-unresolved (177) | **Keep unresolved** | No closed-map leaf (city, postal_code, payment_card_data, OAuth tokens, ambiguous OIDC fields). Honest uncertainty retained. |

## Spot-check queue for Ryan (40 rows)

All contested accepts, all label corrections, all negative-adjudication rejects, plus high-confidence reject samples.

| id | disposition | reasons |
| --- | --- | --- |
| auth0-express-login-route-not-pii | reject | negative reject; high-confidence reject |
| auth0-express-sid-item | reject | high-confidence reject |
| auth0-express-sub-item | reject | high-confidence reject |
| directus-external-identifier | reject | high-confidence reject |
| directus-share-password | accept | contested accept; label correction |
| directus-user-password | accept | contested accept; label correction |
| discourse-oauth2-name | reject | high-confidence reject |
| discourse-oauth2-uid | reject | high-confidence reject |
| discourse-password-hash | reject | high-confidence reject |
| discourse-sso-external-username | accept | contested accept; label correction |
| discourse-user-id | reject | high-confidence reject |
| drupal-http-login-pass | accept | contested accept; label correction |
| drupal-login-pass-credential | accept | contested accept; label correction |
| drupal-pass | accept | contested accept; label correction |
| exposed-no-email-field | reject | negative reject; high-confidence reject |
| ghost-staff-password-item | accept | contested accept; label correction |
| ghost-staff-user-password | accept | contested accept; label correction |
| gitea-username | accept | contested accept; label correction |
| magento-address-firstname | accept | contested accept; label correction |
| magento-address-lastname | accept | contested accept; label correction |
| magento-customer-firstname | accept | contested accept; label correction |
| magento-customer-lastname | accept | contested accept; label correction |
| medusa-no-customer-email-item | reject | negative reject; high-confidence reject |
| medusa-no-customer-phone-item | reject | negative reject; high-confidence reject |
| medusa-no-user-first-name-item | reject | negative reject; high-confidence reject |
| nopcommerce-customer-first-name | accept | contested accept; label correction |
| nopcommerce-customer-last-name | accept | contested accept; label correction |
| nopcommerce-customer-password | accept | contested accept |
| redmine-auth-source-id | reject | negative reject; high-confidence reject |
| redmine-user-firstname | accept | contested accept; label correction |
| redmine-user-lastname | accept | contested accept; label correction |
| spree-address-firstname | accept | contested accept; label correction |
| spree-address-lastname | accept | contested accept; label correction |
| spring-petclinic-owner-first-name | accept | contested accept; label correction |
| spring-petclinic-owner-last-name | accept | contested accept; label correction |
| strapi-user-firstname | accept | contested accept; label correction |
| strapi-user-lastname | accept | contested accept; label correction |
| strapi-user-password | accept | contested accept; label correction |
| wordpress-insert-user-pass-plaintext | accept | contested accept |
| wordpress-user-pass | accept | contested accept; label correction |

## Accounting

247 rows in → 247 ledger entries out. No `data_items.yaml` mutations this slice. No corpus-gold digest bump.

Ledger: `annotations/KDATAP-6b1c67/adjudication-ledger.json`.

Finding issues remain **proposed** until Ryan accepts the packet.

## Human review

Accepted — Ryan Alyn Porter. Status: **packet-accepted**.

## Apply (KDATAP-6b1c67 --apply)

Applied slice-2 ledger dispositions to 29 `data_items.yaml` packets on branch `cursor/adjudicate-data-items-6b1c67`.

### Final disposition counts (slice 2)

| Disposition | Count |
| --- | ---: |
| accept | 27 |
| reject | 43 |
| unresolved | 177 |
| **Total** | **247** |

### Cumulative data-item totals (after apply)

| Disposition | Count |
| --- | ---: |
| accept | 140 |
| reject | 119 |
| unresolved (`needs_adjudication`) | 177 |
| **Total** | **436** |
