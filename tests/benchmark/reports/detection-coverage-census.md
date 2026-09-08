# Detection coverage census

Generated: 2026-09-08T14:17:22.491Z
Scanner git SHA: `998fb12b2db667dd7ff305e34c716634b867e806`
Command: `pnpm run benchmark:census`

Identity-only set membership on accepted component gold positives. No spans, no scoring.

481/563 is vocabulary satisfiability, not detection recall.

## Corpus totals

| Metric | Value |
| --- | ---: |
| Packets | 29 |
| Files ingested | 17943 |
| Components emitted | 1593 |
| Data flows emitted | 2274 |
| Component gold positives | 519 |
| Matched (type:name) | 414 |
| Matched (type:subType) | 410 |
| Matched (hybrid) | 414 |
| Zero-component packets | 2/29 |

## Per-packet rows

| Repo | Commit | Files | Components | Data flows | Gold+ | Match name | Match subtype | Match hybrid | Zero comp |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| auth0-express | `9cdf984` | 26 | 7 | 3 | 3 | 1 | 1 | 1 | no |
| directus | `a6c460a` | 837 | 22 | 72 | 13 | 8 | 8 | 8 | no |
| discourse | `768a4ed` | 445 | 445 | 643 | 156 | 148 | 148 | 148 | no |
| drupal | `141cdc1` | 141 | 4 | 64 | 16 | 3 | 3 | 3 | no |
| easy-school | `69ad989` | 11 | 3 | 6 | 3 | 3 | 3 | 3 | no |
| exposed | `4be9aee` | 107 | 4 | 3 | 2 | 1 | 1 | 1 | no |
| flask-login | `c8bba84` | 8 | 5 | 2 | 2 | 2 | 2 | 2 | no |
| ghost | `73612b1` | 1707 | 19 | 109 | 16 | 13 | 12 | 13 | no |
| gitea | `0b10674` | 86 | 11 | 12 | 2 | 1 | 1 | 1 | no |
| hyperswitch-vault | `abfca8e` | 0 | 0 | 0 | 2 | 0 | 0 | 0 | yes |
| keycloak | `b9b70f9` | 71 | 37 | 32 | 3 | 3 | 3 | 3 | no |
| magento | `3a6b966` | 851 | 88 | 189 | 78 | 70 | 70 | 70 | no |
| medusa | `f731790` | 58 | 9 | 11 | 15 | 3 | 1 | 3 | no |
| medusa-customer | `8476129` | 19 | 4 | 3 | 5 | 5 | 5 | 5 | no |
| nopcommerce | `2f9efdb` | 5034 | 96 | 146 | 13 | 10 | 10 | 10 | no |
| orchard-core | `3dc6303` | 2240 | 74 | 14 | 16 | 9 | 9 | 9 | no |
| ory-kratos-password | `b86338d` | 47 | 11 | 9 | 1 | 1 | 1 | 1 | no |
| pocketbase | `bc8ffed` | 142 | 24 | 32 | 18 | 12 | 12 | 12 | no |
| posthog-user | `a2f78ff` | 385 | 31 | 124 | 2 | 1 | 1 | 1 | no |
| redmine | `2308cb5` | 109 | 194 | 198 | 18 | 14 | 14 | 14 | no |
| saleor | `030c167` | 157 | 8 | 51 | 2 | 2 | 2 | 2 | no |
| spree | `e6e9823` | 1809 | 449 | 338 | 16 | 14 | 14 | 14 | no |
| spring-petclinic | `818c413` | 30 | 6 | 5 | 4 | 2 | 2 | 2 | no |
| strapi | `aaff8e8` | 2394 | 18 | 14 | 14 | 10 | 10 | 10 | no |
| supabase-js | `b3b939a` | 140 | 5 | 12 | 3 | 2 | 1 | 2 | no |
| vapor | `cf330f6` | 0 | 0 | 0 | 2 | 0 | 0 | 0 | yes |
| vgs-django | `46acdb3` | 15 | 2 | 4 | 2 | 1 | 1 | 1 | no |
| wordpress | `98c9e23` | 1034 | 9 | 159 | 90 | 74 | 74 | 74 | no |
| yjdh-employee | `b148e18` | 40 | 8 | 19 | 2 | 1 | 1 | 1 | no |

## Zero-component packets

hyperswitch-vault, vapor
