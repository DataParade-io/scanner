# Annotation pass

## Task

KDATAP-47e33169-a94a-43f6-91c5-7afe1d8217da — Deterministic flow adjudication pass.

Parent: KDATAP-b0d5e2 (corpus gold migration).

## Scope

All 29 corpus packets under `tests/benchmark/repos/*/annotations/data_flows.yaml` (436 rows).

Evidence gathered from pinned source spans and accepted component gold only. No `scan()` or detector output used.

## Adjudication method

Mechanical pass via `tests/benchmark/scripts/adjudicate-flow-gold.ts` and `tests/eval/canonical/compat/flow-adjudication.ts`:

1. **Source buckets** — classify each row by migration candidate shape (rejection, graph_edge, intra overlap, entity picker, unresolved).
2. **Evidence validation** — verify flow claims against pinned source spans; cache misses mark `evidence_validation: skipped` and disposition `unresolved`.
3. **Accept ceiling** — 200 max; this pass produced 121 accepts.
4. **No YAML apply** — ledger only; no `review_state: accepted` written to corpus YAML this slice.
5. **No digest bump** — `corpus-gold.digest` unchanged.

Ledger (short path): `annotations/KDATAP-47e331/adjudication-ledger.json`.

## Disposition summary

| Disposition | Count |
| --- | ---: |
| accept | 121 |
| reject | 17 |
| unresolved | 298 |
| **Total** | **436** |

### By source bucket

| Source bucket | accept | reject | unresolved |
| --- | ---: | ---: | ---: |
| entity_picker_resolved | 46 | 0 | 0 |
| graph_edge | 1 | 0 | 0 |
| intra_low_rationale_only | 0 | 0 | 85 |
| intra_overlap_same_entity | 31 | 0 | 8 |
| intra_single_component | 43 | 0 | 21 |
| rejection | 0 | 17 | 0 |
| unresolved | 0 | 0 | 184 |

| Metric | Value |
| --- | ---: |
| Contested calls | 90 |
| Accept ceiling | 200 |

## Skipped evidence

| Repo | Rows | Reason |
| --- | ---: | --- |
| posthog-user | 2 | Source cache miss; evidence_validation skipped, disposition unresolved |

## Spot-check queue (90 contested rows)

All accepts with `contested: true` require human review before promotion to `review_state: accepted`.

### entity_picker_resolved (46)

- `directus-login-to-sessions-table` (directus)
- `directus-password-verify-bcrypt` (directus)
- `directus-inactive-user-reject` (directus)
- `discourse-admin-users-route-flow` (discourse)
- `discourse-users-index-route-flow` (discourse)
- `discourse-database-adapter-flow` (discourse)
- `drupal-login-form-to-user-auth` (drupal)
- `drupal-login-form-to-finalizer` (drupal)
- `drupal-http-login-to-finalizer` (drupal)
- `drupal-http-login-lookup-account` (drupal)
- `drupal-password-to-password-checker` (drupal)
- `drupal-lookup-account-by-name` (drupal)
- `drupal-one-time-login-url-flow` (drupal)
- `drupal-verify-hmac-flow` (drupal)
- `drupal-finalizer-last-login-to-database` (drupal)
- `drupal-cookie-roles-to-session` (drupal)
- `exposed-database-to-transaction` (exposed)
- `exposed-select-to-result` (exposed)
- `flask-login-session-to-user-loader` (flask-login)
- `flask-login-cookie-to-user-loader` (flask-login)
- `flask-login-session-to-remember-cookie` (flask-login)
- `ghost-member-create-to-database` (ghost)
- `ghost-token-decode-to-sub` (ghost)
- `ghost-staff-setup-credentials` (ghost)
- `ghost-entitlement-token-encode` (ghost)
- `magento-address-form-to-repository` (magento)
- `medusa-notification-to-sendgrid` (medusa)
- `orchard-login-to-authenticate` (orchard-core)
- `orchard-reset-password-flow` (orchard-core)
- `orchard-change-password-flow` (orchard-core)
- `orchard-forgot-password-token` (orchard-core)
- `pocketbase-email-to-verification-token` (pocketbase)
- `redmine-auth-source-authenticate-flow` (redmine)
- `spree-address-to-gateway` (spree)
- `spree-order-to-payment-workflow` (spree)
- `spree-address-clone-billing` (spree)
- `spring-petclinic-vets-to-cache` (spring-petclinic)
- `supabase-js-session-to-storage` (supabase-js)
- `supabase-js-access-token-to-authorization` (supabase-js)
- `vapor-basic-header-to-credentials` (vapor)
- `vapor-session-id-to-authenticator` (vapor)
- `wordpress-signon-to-auth-cookie` (wordpress)
- `wordpress-authenticate-check-password` (wordpress)
- `wordpress-get-user-by-login-flow` (wordpress)
- `wordpress-get-user-by-email-flow` (wordpress)
- `wordpress-author-template-flow` (wordpress)

### intra_single_component (43)

- `directus-extract-token-bearer` (directus)
- `discourse-user-password-association-flow` (discourse)
- `discourse-ip-history-flow` (discourse)
- `discourse-github-settings-flow` (discourse)
- `discourse-twitter-settings-flow` (discourse)
- `discourse-facebook-settings-flow` (discourse)
- `discourse-user-stat-create-flow` (discourse)
- `discourse-google-settings-flow` (discourse)
- `easy-school-guardian-ssn-persisted` (easy-school)
- `ghost-signup-email-to-magic-link` (ghost)
- `ghost-token-to-member-lookup` (ghost)
- `ghost-update-email-to-magic-link` (ghost)
- `ghost-checkout-email-to-stripe` (ghost)
- `keycloak-credential-entity-persist` (keycloak)
- `magento-logout-to-session` (magento)
- `magento-registry-retrieve-flow` (magento)
- `magento-session-set-customer-flow` (magento)
- `medusa-auth-to-github` (medusa)
- `medusa-auth-to-google` (medusa)
- `medusa-customer-module-export` (medusa)
- `medusa-payment-module-export` (medusa)
- `medusa-order-module-export` (medusa)
- `nopcommerce-signout-to-cookie` (nopcommerce)
- `orchard-openid-token-to-store` (orchard-core)
- `ory-kratos-hashed-password-stored` (ory-kratos-password)
- `pocketbase-validate-password-flow` (pocketbase)
- `redmine-api-key-token-create` (redmine)
- `redmine-ldap-bind-password` (redmine)
- `redmine-ldap-login-to-dn` (redmine)
- `spree-payment-to-order` (spree)
- `strapi-token-create-random` (strapi)
- `vgs-django-pii-model-persisted` (vgs-django)
- `vgs-django-checkr-candidate-post` (vgs-django)
- `wordpress-token-to-auth-cookie` (wordpress)
- `wordpress-hash-password-flow` (wordpress)
- `wordpress-set-password-flow` (wordpress)
- `wordpress-authenticate-flow` (wordpress)
- `wordpress-clear-cookie-flow` (wordpress)
- `wordpress-create-user-flow` (wordpress)
- `wordpress-insert-user-flow` (wordpress)
- `wordpress-check-reset-key-flow` (wordpress)
- `wordpress-cache-set-flow` (wordpress)
- `wordpress-generate-password-flow` (wordpress)

### intra_overlap_same_entity (0)



### graph_edge (1)

- `saleor-user-email-persisted` (saleor)

## Accounting

436 in → 436 out. Every row has a ledger entry with disposition. No flow YAML `review_state` changes this slice. No `corpus-gold.digest` bump.

## Human review

Pending — Ryan Alyn Porter. Status: **awaiting-review**.
