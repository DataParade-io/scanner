# Detection coverage census

Generated: 2026-08-31T21:30:28.419Z
Scanner git SHA: `a0f040fba710edc426127da7791395f7df630481`
Command: `pnpm run benchmark:census`

Identity-only set membership on accepted component gold positives. No spans, no scoring.

481/563 is vocabulary satisfiability, not detection recall.

## Corpus totals

| Metric | Value |
| --- | ---: |
| Packets | 29 |
| Files ingested | 16567 |
| Components emitted | 236 |
| Data flows emitted | 160 |
| Component gold positives | 519 |
| Matched (type:name) | 11 |
| Matched (type:subType) | 97 |
| Matched (hybrid) | 101 |
| Zero-component packets | 8/29 |

## Per-packet rows

| Repo | Commit | Files | Components | Data flows | Gold+ | Match name | Match subtype | Match hybrid | Zero comp |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| auth0-express | `9cdf984` | 30 | 3 | 2 | 3 | 0 | 0 | 0 | no |
| directus | `a6c460a` | 864 | 13 | 15 | 13 | 0 | 2 | 2 | no |
| discourse | `768a4ed` | 129 | 0 | 0 | 156 | 0 | 0 | 0 | yes |
| drupal | `141cdc1` | 183 | 2 | 1 | 16 | 0 | 0 | 0 | no |
| easy-school | `69ad989` | 12 | 0 | 0 | 3 | 0 | 0 | 0 | yes |
| exposed | `4be9aee` | 108 | 4 | 3 | 2 | 0 | 1 | 1 | no |
| flask-login | `c8bba84` | 10 | 0 | 0 | 2 | 0 | 0 | 0 | yes |
| ghost | `73612b1` | 1740 | 13 | 15 | 16 | 7 | 9 | 10 | no |
| gitea | `0b10674` | 96 | 8 | 7 | 2 | 0 | 1 | 1 | no |
| hyperswitch-vault | `abfca8e` | 27 | 0 | 0 | 2 | 0 | 0 | 0 | yes |
| keycloak | `b9b70f9` | 72 | 5 | 4 | 3 | 0 | 3 | 3 | no |
| magento | `3a6b966` | 854 | 0 | 0 | 78 | 0 | 0 | 0 | yes |
| medusa | `f731790` | 66 | 9 | 7 | 15 | 2 | 1 | 3 | no |
| medusa-customer | `8476129` | 28 | 4 | 3 | 5 | 0 | 5 | 5 | no |
| nopcommerce | `2f9efdb` | 5106 | 85 | 53 | 13 | 0 | 6 | 6 | no |
| orchard-core | `3dc6303` | 2248 | 36 | 6 | 16 | 0 | 4 | 4 | no |
| ory-kratos-password | `b86338d` | 96 | 9 | 8 | 1 | 0 | 0 | 0 | no |
| pocketbase | `bc8ffed` | 144 | 2 | 1 | 18 | 0 | 4 | 4 | no |
| posthog-user | `a2f78ff` | 414 | 9 | 8 | 2 | 0 | 1 | 1 | no |
| redmine | `2308cb5` | 55 | 0 | 0 | 18 | 0 | 0 | 0 | yes |
| saleor | `030c167` | 160 | 5 | 4 | 2 | 0 | 2 | 2 | no |
| spree | `e6e9823` | 16 | 0 | 0 | 16 | 0 | 0 | 0 | yes |
| spring-petclinic | `818c413` | 32 | 6 | 5 | 4 | 1 | 2 | 2 | no |
| strapi | `aaff8e8` | 2655 | 7 | 6 | 14 | 0 | 2 | 2 | no |
| supabase-js | `b3b939a` | 195 | 5 | 4 | 3 | 1 | 1 | 2 | no |
| vapor | `cf330f6` | 1 | 0 | 0 | 2 | 0 | 0 | 0 | yes |
| vgs-django | `46acdb3` | 16 | 1 | 0 | 2 | 0 | 0 | 0 | no |
| wordpress | `98c9e23` | 1162 | 4 | 3 | 90 | 0 | 52 | 52 | no |
| yjdh-employee | `b148e18` | 48 | 6 | 5 | 2 | 0 | 1 | 1 | no |

## Zero-component packets

discourse, easy-school, flask-login, hyperswitch-vault, magento, redmine, spree, vapor
