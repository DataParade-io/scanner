# Annotation pass

## Task

KDATAP-47e33169-a94a-43f6-91c5-7afe1d8217da — Deterministic flow adjudication pass.

Parent: KDATAP-b0d5e2 (corpus gold migration).

## Scope

All 29 corpus packets under `tests/benchmark/repos/*/annotations/data_flows.yaml` (436 rows).

Evidence gathered from pinned source spans and accepted component gold only. No `scan()` or detector output used.

## Adjudication method

Mechanical pass via `tests/benchmark/scripts/adjudicate-flow-gold.ts` and `tests/eval/canonical/compat/flow-adjudication.ts`:

1. **Source buckets** — classify each row by migration candidate shape.
2. **Evidence validation** — declaration-only spans marked `unverified`.
3. **Cache miss** — negative `rejection` rows reject without source cache.
4. **Accept ceiling** — 200 max; this pass produced 146 accepts.
5. **No YAML apply** — ledger only.
6. **No digest bump** — `corpus-gold.digest` unchanged.

Ledger: `annotations/KDATAP-47e331/adjudication-ledger.json`.

## Fixes applied (CI + review)

- Cache miss + negative → reject (17 rows).
- Declaration-only demotion (52 prior accepts demoted).
- Single-component runtime flows (77 prior unresolved promoted).
- Entity picker tightened (overlap or runtime identifier required).
- API/service tie-break for ambiguous overlap.

## Disposition summary

| Disposition | Count |
| --- | ---: |
| accept | 146 |
| reject | 17 |
| unresolved | 273 |
| **Total** | **436** |

### By source bucket

| Source bucket | accept | reject | unresolved |
| --- | ---: | ---: | ---: |
| entity_picker_resolved | 72 | 0 | 0 |
| graph_edge | 1 | 0 | 0 |
| intra_low_rationale_only | 0 | 0 | 85 |
| intra_overlap_same_entity | 25 | 0 | 14 |
| intra_single_component | 48 | 0 | 16 |
| rejection | 0 | 17 | 0 |
| unresolved | 0 | 0 | 158 |

| Metric | Value |
| --- | ---: |
| Contested calls | 121 |
| Accept ceiling | 200 |
| Prior accepts demoted | 52 |
| Prior unresolved promoted | 77 |

## Skipped evidence

| Repo | Rows | Reason |
| --- | ---: | --- |
| posthog-user | 2 | cache miss |

## Spot-check queue (121 contested rows)

### entity_picker_resolved (72)

- `directus-password-verify-bcrypt` (directus)
- `directus-login-emitter-filter` (directus)
- `directus-users-service-collection` (directus)
- `discourse-session-cookie-config` (discourse)
- `discourse-admin-users-route-flow` (discourse)
- `discourse-global-api-key-hash-flow` (discourse)
- `discourse-sso-route-flow` (discourse)
- `discourse-session-cookie-flow` (discourse)
- `ghost-jwt-member-request-property` (ghost)
- `magento-webapi-v1-customergroups-id-flow` (magento)
- `magento-webapi-v1-customergroups-default-storeid-flow` (magento)
- `magento-webapi-v1-customergroups-default-flow` (magento)
- `magento-webapi-v1-customergroups-default-id-flow` (magento)
- `magento-webapi-v1-customergroups-id-permissions-flow` (magento)
- `magento-webapi-v1-customergroups-search-flow` (magento)
- `magento-webapi-v1-customergroups-flow` (magento)
- `magento-webapi-v1-attributemetadata-customer-attribute-attributecode-flow` (magento)
- `magento-webapi-v1-attributemetadata-customer-form-formcode-flow` (magento)
- `magento-webapi-v1-attributemetadata-customer-flow` (magento)
- `magento-webapi-v1-attributemetadata-customer-custom-flow` (magento)
- `magento-webapi-v1-attributemetadata-customeraddress-attribute-attributecode-flow` (magento)
- `magento-webapi-v1-attributemetadata-customeraddress-form-formcode-flow` (magento)
- `magento-webapi-v1-attributemetadata-customeraddress-flow` (magento)
- `magento-webapi-v1-attributemetadata-customeraddress-custom-flow` (magento)
- `magento-webapi-v1-customers-customerid-flow` (magento)
- `magento-webapi-v1-customers-me-flow` (magento)
- `magento-webapi-v1-customers-search-flow` (magento)
- `magento-webapi-v1-customers-email-activate-flow` (magento)
- `magento-webapi-v1-customers-customerid-password-resetlinktoken-resetpasswordlinktoken-flow` (magento)
- `magento-webapi-v1-customers-password-flow` (magento)
- `magento-webapi-v1-customers-resetpassword-flow` (magento)
- `magento-webapi-v1-customers-customerid-confirm-flow` (magento)
- `magento-webapi-v1-customers-confirm-flow` (magento)
- `magento-webapi-v1-customers-validate-flow` (magento)
- `magento-webapi-v1-customers-customerid-permissions-readonly-flow` (magento)
- `magento-webapi-v1-customers-isemailavailable-flow` (magento)
- `magento-webapi-v1-customers-addresses-addressid-flow` (magento)
- `magento-webapi-v1-customers-me-billingaddress-flow` (magento)
- `magento-webapi-v1-customers-customerid-billingaddress-flow` (magento)
- `magento-webapi-v1-customers-me-shippingaddress-flow` (magento)
- `magento-webapi-v1-customers-customerid-shippingaddress-flow` (magento)
- `magento-webapi-v1-addresses-addressid-flow` (magento)
- `magento-webapi-v1-customers-activate-flow` (magento)
- `magento-auth-failure-increment` (magento)
- `magento-customer-save-flow` (magento)
- `magento-webapi-get-self-flow` (magento)
- `magento-webapi-put-self-flow` (magento)
- `medusa-notification-to-sendgrid` (medusa)
- `nopcommerce-login-to-customer-service` (nopcommerce)
- `nopcommerce-signin-to-cookie-claims` (nopcommerce)
- `nopcommerce-cookie-claim-to-customer-lookup` (nopcommerce)
- `nopcommerce-validate-to-current-password` (nopcommerce)
- `nopcommerce-password-hash-to-repository` (nopcommerce)
- `nopcommerce-email-to-customer-lookup` (nopcommerce)
- `nopcommerce-failed-login-to-lockout` (nopcommerce)
- `orchard-reset-password-flow` (orchard-core)
- `pocketbase-email-to-verification-token` (pocketbase)
- `redmine-ldap-to-user-create` (redmine)
- `redmine-session-token-create` (redmine)
- `redmine-email-change-destroys-recovery-tokens` (redmine)
- `redmine-autologin-key-to-user` (redmine)
- `redmine-auth-source-authenticate-flow` (redmine)
- `strapi-login-to-check-credentials` (strapi)
- `strapi-login-password-compare` (strapi)
- `strapi-passport-to-check-credentials` (strapi)
- `vapor-session-id-to-authenticator` (vapor)
- `wordpress-signon-to-auth-cookie` (wordpress)
- `wordpress-authenticate-check-password` (wordpress)
- `wordpress-app-password-plaintext-to-hash` (wordpress)
- `wordpress-get-user-by-login-flow` (wordpress)
- `wordpress-get-user-by-email-flow` (wordpress)
- `wordpress-author-template-flow` (wordpress)

### intra_single_component (48)

- `directus-extract-token-bearer` (directus)
- `discourse-user-password-association-flow` (discourse)
- `discourse-ip-history-flow` (discourse)
- `discourse-user-stat-create-flow` (discourse)
- `easy-school-guardian-ssn-persisted` (easy-school)
- `ghost-signup-email-to-magic-link` (ghost)
- `ghost-token-to-member-lookup` (ghost)
- `ghost-update-email-to-magic-link` (ghost)
- `ghost-checkout-email-to-stripe` (ghost)
- `keycloak-credential-entity-persist` (keycloak)
- `magento-login-post-to-authenticate` (magento)
- `magento-create-post-to-create-account` (magento)
- `magento-logout-to-session` (magento)
- `magento-send-reset-email-flow` (magento)
- `medusa-auth-to-github` (medusa)
- `medusa-auth-to-google` (medusa)
- `medusa-customer-module-export` (medusa)
- `medusa-user-module-export` (medusa)
- `medusa-rbac-module-export` (medusa)
- `medusa-payment-module-export` (medusa)
- `medusa-order-module-export` (medusa)
- `nopcommerce-signout-to-cookie` (nopcommerce)
- `nopcommerce-insert-customer-to-db` (nopcommerce)
- `orchard-create-user-to-store` (orchard-core)
- `orchard-openid-token-to-store` (orchard-core)
- `pocketbase-validate-password-flow` (pocketbase)
- `pocketbase-jwt-to-record-lookup` (pocketbase)
- `redmine-api-key-token-create` (redmine)
- `redmine-ldap-bind-password` (redmine)
- `redmine-ldap-login-to-dn` (redmine)
- `redmine-token-find-active-user` (redmine)
- `spree-customer-email-to-order` (spree)
- `spree-customer-to-gateway-customer` (spree)
- `spree-order-belongs-to-customer` (spree)
- `spree-payment-source-to-gateway-customer` (spree)
- `spree-credit-card-to-customer` (spree)
- `spree-payment-to-order` (spree)
- `spree-create-account-from-order` (spree)
- `spree-payment-method-gateway-customers` (spree)
- `strapi-token-create-random` (strapi)
- `vgs-django-pii-model-persisted` (vgs-django)
- `vgs-django-checkr-candidate-post` (vgs-django)
- `wordpress-token-to-auth-cookie` (wordpress)
- `wordpress-hash-password-flow` (wordpress)
- `wordpress-set-password-flow` (wordpress)
- `wordpress-authenticate-flow` (wordpress)
- `wordpress-create-user-flow` (wordpress)
- `wordpress-check-reset-key-flow` (wordpress)

### intra_overlap_same_entity (0)



### graph_edge (1)

- `saleor-user-email-persisted` (saleor)

## Key demotions

- `directus-login-to-sessions-table`
- `directus-inactive-user-reject`
- `discourse-users-index-route-flow`
- `discourse-github-settings-flow`
- `discourse-twitter-settings-flow`
- `discourse-facebook-settings-flow`
- `discourse-database-adapter-flow`
- `discourse-google-settings-flow`
- `drupal-login-form-to-user-auth`
- `drupal-login-form-to-finalizer`
- `drupal-http-login-to-finalizer`
- `drupal-http-login-lookup-account`
- `drupal-password-to-password-checker`
- `drupal-lookup-account-by-name`
- `drupal-one-time-login-url-flow`
- `drupal-verify-hmac-flow`
- `drupal-finalizer-last-login-to-database`
- `drupal-cookie-roles-to-session`
- `exposed-database-to-transaction`
- `exposed-select-to-result`
- `flask-login-session-to-user-loader`
- `flask-login-cookie-to-user-loader`
- `flask-login-session-to-remember-cookie`
- `ghost-member-create-to-database`
- `ghost-token-decode-to-sub`

## Key promotions

- `directus-login-emitter-filter`
- `directus-users-service-collection`
- `discourse-session-cookie-config`
- `discourse-global-api-key-hash-flow`
- `discourse-sso-route-flow`
- `discourse-session-cookie-flow`
- `ghost-jwt-member-request-property`
- `magento-login-post-to-authenticate`
- `magento-webapi-v1-customergroups-id-flow`
- `magento-webapi-v1-customergroups-default-storeid-flow`
- `magento-webapi-v1-customergroups-default-flow`
- `magento-webapi-v1-customergroups-default-id-flow`
- `magento-webapi-v1-customergroups-id-permissions-flow`
- `magento-webapi-v1-customergroups-search-flow`
- `magento-webapi-v1-customergroups-flow`
- `magento-webapi-v1-attributemetadata-customer-attribute-attributecode-flow`
- `magento-webapi-v1-attributemetadata-customer-form-formcode-flow`
- `magento-webapi-v1-attributemetadata-customer-flow`
- `magento-webapi-v1-attributemetadata-customer-custom-flow`
- `magento-webapi-v1-attributemetadata-customeraddress-attribute-attributecode-flow`
- `magento-webapi-v1-attributemetadata-customeraddress-form-formcode-flow`
- `magento-webapi-v1-attributemetadata-customeraddress-flow`
- `magento-webapi-v1-attributemetadata-customeraddress-custom-flow`
- `magento-webapi-v1-customers-customerid-flow`
- `magento-webapi-v1-customers-me-flow`

## Accounting

436 in → 436 out.

## Human review

Pending — Ryan Alyn Porter. Status: **awaiting-review**.
