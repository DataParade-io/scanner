# Annotation pass — KDATAP-25b2f474-1d4a-4279-bfcc-b6a73343714a

## Task

KDATAP-25b2f4 — Deterministic AI adjudication of data-item gold rows.

Parent: KDATAP-b0d5e2. Follows accepted labeling passes KDATAP-a0e80b + KDATAP-9b83f6.

## Scope

All 29 corpus packets under `tests/benchmark/repos/*/annotations/data_items.yaml` (436 rows).

Evidence from pinned source spans (±5 lines) and `patterns/personal-data-concept-map.yaml` only. No `scan()` or detector output.

## Method

Option B (ledger-then-flip): this slice writes `annotations/KDATAP-25b2f4/adjudication-ledger.json` only. YAML `review_state` is **not** updated until Ryan accepts the packet and a later `--apply` run.

Script: `tests/benchmark/scripts/adjudicate-data-item-gold.ts`

- Deterministic accept / reject / unresolved
- Accept ceiling: 140 (actual: 114)
- Hard fail on cache miss, invented leaf, or accept > ceiling

## Disposition summary

| Disposition | Count |
| --- | ---: |
| accept | 114 |
| reject | 75 |
| unresolved | 247 |
| **Total** | **436** |

### By a0e80b source bucket

| Bucket | Accept | Reject | Unresolved |
| --- | --- | --- | --- |
| ambiguous | 0 | 0 | 52 |
| negative_adjudication | 1 | 75 | 6 |
| tier_a_canonical_suffix | 76 | 0 | 0 |
| tier_b_label_guided | 37 | 0 | 0 |
| tier_c_category_unmapped | 0 | 0 | 146 |
| tier_e_never_auto_map | 0 | 0 | 43 |

## Label corrections (49)

Annotation defects documented in ledger (`label_correction` block); applied to YAML only on `--apply`.

| id | before → after | leaf |
| --- | --- | --- |
| directus-user-first-name | person_name → first_name | first_name |
| directus-user-last-name | person_name → last_name | last_name |
| discourse-username | user_identifier → username | username |
| easy-school-student-first-name | person_name → first_name | first_name |
| easy-school-student-last-name | person_name → last_name | last_name |
| easy-school-student-address | street_address → address | address |
| easy-school-guardian-ssn | national_identifier → social_security_number | social_security_number |
| gitea-full-name | person_name → full_name | full_name |
| gitea-settings-full-name | person_name → full_name | full_name |
| gitea-settings-full-name-option | person_name → full_name | full_name |
| keycloak-username | user_identifier → username | username |
| keycloak-first-name | person_name → first_name | first_name |
| keycloak-last-name | person_name → last_name | last_name |
| magento-login-password | credential_secret → password | password |
| medusa-user-first-name | person_name → first_name | first_name |
| medusa-user-last-name | person_name → last_name | last_name |
| medusa-customer-first-name | person_name → first_name | first_name |
| medusa-customer-last-name | person_name → last_name | last_name |
| nopcommerce-customer-username | user_identifier → username | username |
| nopcommerce-customer-firstname | person_name → first_name | first_name |
| nopcommerce-customer-lastname | person_name → last_name | last_name |
| orchard-login-username | user_identifier → username | username |
| orchard-login-password | credential_secret → password | password |
| orchard-user-name | user_identifier → username | username |
| pocketbase-plain-password-transient | credential_secret → password | password |
| pocketbase-set-password | credential_secret → password | password |
| pocketbase-smtp-username | user_identifier → username | username |
| pocketbase-smtp-password | credential_secret → password | password |
| redmine-plain-password | credential_secret → password | password |
| saleor-address-first-name | person_name → first_name | first_name |
| saleor-address-last-name | person_name → last_name | last_name |
| saleor-user-first-name | person_name → first_name | first_name |
| saleor-user-last-name | person_name → last_name | last_name |
| spree-customer-first-name | person_name → first_name | first_name |
| spree-customer-last-name | person_name → last_name | last_name |
| spring-petclinic-owner-address | street_address → address | address |
| strapi-username | user_identifier → username | username |
| vapor-basic-username-item | user_identifier → username | username |
| vapor-basic-password-item | credential_secret → password | password |
| vgs-django-ssn | national_identifier → social_security_number | social_security_number |
| wordpress-first-name | person_name → first_name | first_name |
| wordpress-last-name | person_name → last_name | last_name |
| wordpress-rest-username-schema | user_identifier → username | username |
| wordpress-rest-password-schema | credential_secret → password | password |
| yjdh-first-name | person_name → first_name | first_name |
| yjdh-last-name | person_name → last_name | last_name |
| yjdh-finnish-social-security-number | national_identifier → social_security_number | social_security_number |
| yjdh-ssn-validation | national_identifier → social_security_number | social_security_number |
| yjdh-search-ssn | national_identifier → social_security_number | social_security_number |

## Contested calls (38)

Low-confidence accepts, negative flips, and flagged accepts (`contested: true` in ledger).

| id | disposition | confidence | bucket | rationale |
| --- | --- | --- | --- | --- |
| discourse-invite-email | accept | medium | tier_b_label_guided | Source verifies 'email' as email_address via closed concept map. |
| discourse-sso-external-email | accept | medium | tier_b_label_guided | Source verifies 'external_email' as email_address via closed concept map. |
| discourse-incoming-from-address | accept | medium | tier_b_label_guided | Source verifies 'from_address' as email_address via closed concept map. |
| discourse-email-change-new-email | accept | medium | tier_b_label_guided | Source verifies 'new_email' as email_address via closed concept map. |
| drupal-mail | accept | medium | tier_b_label_guided | Source verifies 'mail' as email_address via closed concept map. |
| drupal-init-email | accept | medium | tier_b_label_guided | Source verifies 'init' as email_address via closed concept map. |
| drupal-get-email | accept | medium | tier_b_label_guided | Source verifies 'getEmail' as email_address via closed concept map. |
| exposed-schema-password-not-data-item | accept | medium | negative_adjudication | Source span confirms mapped personal-data field 'password' despite negative label. |
| ghost-staff-user-email | accept | medium | tier_b_label_guided | Source verifies 'email' as email_address via closed concept map. |
| ghost-invite-email | accept | medium | tier_b_label_guided | Source verifies 'email' as email_address via closed concept map. |
| magento-customer-dob | accept | medium | tier_b_label_guided | Source verifies 'DOB' as date_of_birth via closed concept map. |
| magento-address-telephone | accept | medium | tier_b_label_guided | Source verifies 'TELEPHONE' as phone_number via closed concept map. |
| magento-address-fax | accept | medium | tier_b_label_guided | Source verifies 'fax' as phone_number via closed concept map. |
| medusa-customer-phone | accept | medium | tier_b_label_guided | Source verifies 'phone' as phone_number via closed concept map. |
| nopcommerce-customer-phone | accept | medium | tier_b_label_guided | Source verifies 'Phone' as phone_number via closed concept map. |
| nopcommerce-customer-dob | accept | medium | tier_b_label_guided | Source verifies 'DateOfBirth' as date_of_birth via closed concept map. |
| nopcommerce-phone | accept | medium | tier_b_label_guided | Source verifies 'Phone' as phone_number via closed concept map. |
| nopcommerce-fax | accept | medium | tier_b_label_guided | Source verifies 'Fax' as phone_number via closed concept map. |
| orchard-user-phone-number | accept | medium | tier_b_label_guided | Source verifies 'PhoneNumber' as phone_number via closed concept map. |
| orchard-forgot-password-username-or-email | accept | medium | tier_b_label_guided | Source verifies 'UsernameOrEmail' as email_address via closed concept map. |
| orchard-normalized-email | accept | medium | tier_b_label_guided | Source verifies 'NormalizedEmail' as email_address via closed concept map. |
| pocketbase-token-claim-new-email | accept | medium | tier_b_label_guided | Source verifies 'TokenClaimNewEmail' as email_address via closed concept map. |
| posthog-pending-email | accept | medium | tier_b_label_guided | Source verifies 'pending_email' as email_address via closed concept map. |
| redmine-email-address | accept | medium | tier_b_label_guided | Source verifies 'address' as email_address via closed concept map. |
| redmine-user-mail-accessor | accept | medium | tier_b_label_guided | Source verifies 'mail' as email_address via closed concept map. |
| saleor-phone | accept | medium | tier_b_label_guided | Source verifies 'phone' as phone_number via closed concept map. |
| saleor-staff-email | accept | medium | tier_b_label_guided | Source verifies 'staff_email' as email_address via closed concept map. |
| spree-customer-phone | accept | medium | tier_b_label_guided | Source verifies 'phone' as phone_number via closed concept map. |
| spree-address-phone | accept | medium | tier_b_label_guided | Source verifies 'phone' as phone_number via closed concept map. |
| spring-petclinic-owner-telephone | accept | medium | tier_b_label_guided | Source verifies 'telephone' as phone_number via closed concept map. |
| supabase-js-new-email | accept | medium | tier_b_label_guided | Source verifies 'new_email' as email_address via closed concept map. |
| supabase-js-phone | accept | medium | tier_b_label_guided | Source verifies 'phone' as phone_number via closed concept map. |
| supabase-js-new-phone | accept | medium | tier_b_label_guided | Source verifies 'new_phone' as phone_number via closed concept map. |
| wordpress-user-email | accept | medium | tier_b_label_guided | Source verifies 'user_email' as email_address via closed concept map. |
| wordpress-comment-author-email | accept | medium | tier_b_label_guided | Source verifies 'comment_author_email' as email_address via closed concept map. |
| wordpress-rest-prepare-email | accept | medium | tier_b_label_guided | Source verifies 'user_email' as email_address via closed concept map. |
| wordpress-rest-comment-author-email-schema | accept | medium | tier_b_label_guided | Source verifies 'author_email' as email_address via closed concept map. |
| yjdh-birthday | accept | medium | tier_b_label_guided | Source verifies 'birthday' as date_of_birth via closed concept map. |

Negative flip: `exposed-schema-password-not-data-item`.

Tier E accepts: 0.

## Spot-check queue for Ryan (92 rows)

All medium-confidence accepts, all label corrections, all negative flips, plus ~10% stratified sample of high-confidence accepts.

| id | disposition | reasons |
| --- | --- | --- |
| directus-user-email | accept | high-confidence sample |
| directus-user-first-name | accept | label correction |
| directus-user-last-name | accept | label correction |
| discourse-email-change-new-email | accept | low-confidence accept |
| discourse-email-token-email | accept | high-confidence sample |
| discourse-incoming-from-address | accept | low-confidence accept |
| discourse-invite-email | accept | low-confidence accept |
| discourse-sso-external-email | accept | low-confidence accept |
| discourse-username | accept | label correction |
| drupal-get-email | accept | low-confidence accept |
| drupal-init-email | accept | low-confidence accept |
| drupal-mail | accept | low-confidence accept |
| easy-school-guardian-phone | accept | high-confidence sample |
| easy-school-guardian-ssn | accept | label correction |
| easy-school-student-address | accept | label correction |
| easy-school-student-first-name | accept | label correction |
| easy-school-student-last-name | accept | label correction |
| exposed-schema-password-not-data-item | accept | low-confidence accept; negative flip |
| ghost-invite-email | accept | low-confidence accept |
| ghost-staff-user-email | accept | low-confidence accept |
| gitea-full-name | accept | label correction |
| gitea-settings-full-name | accept | label correction |
| gitea-settings-full-name-option | accept | label correction |
| keycloak-first-name | accept | label correction; high-confidence sample |
| keycloak-last-name | accept | label correction |
| keycloak-username | accept | label correction |
| magento-address-fax | accept | low-confidence accept |
| magento-address-telephone | accept | low-confidence accept |
| magento-customer-dob | accept | low-confidence accept |
| magento-login-password | accept | label correction |
| medusa-customer-first-name | accept | label correction |
| medusa-customer-last-name | accept | label correction |
| medusa-customer-phone | accept | low-confidence accept |
| medusa-user-email | accept | high-confidence sample |
| medusa-user-first-name | accept | label correction |
| medusa-user-last-name | accept | label correction |
| nopcommerce-customer-dob | accept | low-confidence accept |
| nopcommerce-customer-firstname | accept | label correction; high-confidence sample |
| nopcommerce-customer-lastname | accept | label correction |
| nopcommerce-customer-phone | accept | low-confidence accept |
| nopcommerce-customer-username | accept | label correction |
| nopcommerce-fax | accept | low-confidence accept |
| nopcommerce-phone | accept | low-confidence accept |
| orchard-forgot-password-username-or-email | accept | low-confidence accept |
| orchard-login-password | accept | label correction |
| orchard-login-username | accept | label correction |
| orchard-normalized-email | accept | low-confidence accept |
| orchard-user-name | accept | label correction |
| orchard-user-phone-number | accept | low-confidence accept |
| pocketbase-plain-password-transient | accept | label correction |
| pocketbase-set-password | accept | label correction |
| pocketbase-smtp-password | accept | label correction |
| pocketbase-smtp-username | accept | label correction |
| pocketbase-token-claim-email | accept | high-confidence sample |
| pocketbase-token-claim-new-email | accept | low-confidence accept |
| posthog-pending-email | accept | low-confidence accept |
| redmine-email-address | accept | low-confidence accept |
| redmine-plain-password | accept | label correction |
| redmine-user-mail-accessor | accept | low-confidence accept |
| saleor-address-first-name | accept | label correction; high-confidence sample |
| saleor-address-last-name | accept | label correction |
| saleor-phone | accept | low-confidence accept |
| saleor-staff-email | accept | low-confidence accept |
| saleor-user-first-name | accept | label correction |
| saleor-user-last-name | accept | label correction |
| spree-address-phone | accept | low-confidence accept |
| spree-customer-first-name | accept | label correction |
| spree-customer-last-name | accept | label correction; high-confidence sample |
| spree-customer-phone | accept | low-confidence accept |
| spring-petclinic-owner-address | accept | label correction |
| spring-petclinic-owner-telephone | accept | low-confidence accept |
| strapi-username | accept | label correction |
| supabase-js-new-email | accept | low-confidence accept |
| supabase-js-new-phone | accept | low-confidence accept |
| supabase-js-phone | accept | low-confidence accept |
| vapor-basic-password-item | accept | label correction; high-confidence sample |
| vapor-basic-username-item | accept | label correction |
| vgs-django-ssn | accept | label correction |
| wordpress-comment-author-email | accept | low-confidence accept |
| wordpress-first-name | accept | label correction |
| wordpress-last-name | accept | label correction |
| wordpress-rest-comment-author-email-schema | accept | low-confidence accept |
| wordpress-rest-password-schema | accept | label correction |
| wordpress-rest-prepare-email | accept | low-confidence accept |
| wordpress-rest-username-schema | accept | label correction |
| wordpress-user-email | accept | low-confidence accept |
| yjdh-birthday | accept | low-confidence accept |
| yjdh-finnish-social-security-number | accept | label correction |
| yjdh-first-name | accept | label correction; high-confidence sample |
| yjdh-last-name | accept | label correction |
| yjdh-search-ssn | accept | label correction |
| yjdh-ssn-validation | accept | label correction |

## Accounting

436 rows in → 436 ledger entries out. No `data_items.yaml` mutations this slice. No corpus-gold digest bump.

Ledger: `annotations/KDATAP-25b2f4/adjudication-ledger.json`.

## Human review

Pending — Ryan Alyn Porter. Status: **awaiting-review**.
