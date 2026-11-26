# Agent vs scanner pilot (2026-10-21)

Models via Pi: `openai/gpt-6-luna`, thinking=high. Gold (accepted positives): discourse 40 components / 16 flows.
Price openai/gpt-6-luna: standard tier, USD per 1M tokens input 0.1 / cached 0.01 / output 0.5; source https://developers.openai.com/api/docs/pricing, retrieved 2026-10-20.

## Accuracy and cost side by side

| Repo | Arm | Comp P | Comp R | Flow P | Flow R | Strict comp P / R | Strict flow P / R | Input tok | Cached tok | Output tok | Total cost | Cost / correct comp | Cost / correct flow | Wall time | Requests | Tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| discourse | pi + gpt-6-luna (high) | 69% | 23% | 0% | 0% | 62% / 20% | 0% / 0% | 79645 | 892403 | 11764 | $0.0228 | $0.00253 | n/a (0 correct) | 139.3s | 23 | 67 |
| discourse | scanner (AI off) | 73% | 20% | 2% | 44% | 64% / 18% | 2% / 44% | 0 | 0 | 0 | $0.0000 | $0.00000 | $0.00000 | 99.8s | - | - |

Match rule: same kind (component type:subType; for flows, the target's type:subType), same file, line ranges within 10 lines (overlap = 0), one-to-one, names only break ties. Precision is over items with evidence inside the reviewed scope files. The strict columns use the same rule with overlap required (0 lines). Cost per correct = total cost divided by in-scope items matched to a gold label.

| Repo | Arm | Layer | Gold | Items | In scope | Correct (TP, within 10 lines) | Gold found | Strict TP (overlap) |
|---|---|---|---|---|---|---|---|---|
| discourse | pi + gpt-6-luna (high) | components | 40 | 15 | 13 | 9 | 9 | 8 |
| discourse | pi + gpt-6-luna (high) | flows | 16 | 13 | 6 | 0 | 0 | 0 |
| discourse | scanner (AI off) | components | 40 | 15 | 11 | 8 | 8 | 7 |
| discourse | scanner (AI off) | flows | 16 | 444 | 373 | 7 | 7 | 7 |

## Existing identity-key scorer, scanner only (reference)

- discourse components: precision 27%, recall 8%
- discourse data-flows: precision 2%, recall 50%

## Run notes

- discourse: gpt-6-luna: facts.json valid (15 components, 13 flows); 23 requests, 67 tool calls

## discourse / pi + gpt-6-luna (high): misses and false positives

Missed gold components (31): asset:auth_service "UserAuthToken" @ app/models/user_auth_token.rb:4-4 | asset:api "SiteController" @ config/routes.rb:78-78 | third_party:auth_provider "Google OAuth2" @ config/site_settings.yml:758-764 | third_party:email_provider "SendGrid" @ config/routes.rb:38-38 | actor:customer "User" @ app/models/user.rb:3-3 | asset:auth_service "EmailToken" @ app/models/email_token.rb:3-3 | asset:auth_service "Oauth2UserInfo" @ app/models/oauth2_user_info.rb:3-3 | asset:auth_service "UserAuthToken" @ app/models/user_auth_token.rb:4-4 | asset:auth_service "UserAuthTokenLog" @ app/models/user_auth_token_log.rb:3-3 | asset:api "UsersController" @ config/routes.rb:170-170 | asset:api "SessionController csrf" @ config/routes.rb:598-598 | asset:api "StaticController login" @ config/routes.rb:622-622 | asset:api "Admin::UsersController" @ config/routes.rb:130-130 | asset:api "WebhooksController mailgun" @ config/routes.rb:32-32 | asset:auth_service "EmailLoginCode" @ app/models/email_login_code.rb:3-3

False-positive components (4): asset:service "MessageBus realtime delivery service" @ config/initializers/004-message_bus.rb:140-150, app/models/user.rb:918-931 | actor:customer "Forum members" @ app/models/user.rb:19-22, config/routes.rb:648-653 | actor:admin "Forum administrators" @ config/routes.rb:98-107 | asset:auth_service "User authentication token service" @ app/models/user_auth_token.rb:100-120

Missed gold flows (16): asset:auth_service "Session store to cookie" @ config/initializers/100-session_store.rb:5-7 | asset:api "Admin::UsersController HTTP route" @ config/routes.rb:130-130 | asset:api "WebhooksController mailgun HTTP route" @ config/routes.rb:32-32 | actor:customer "User to user_password" @ app/models/user.rb:84-84 | asset:database "Email to primary flag" @ app/models/user_email.rb:16-16 | asset:auth_service "Scopes to user API key" @ app/models/user_api_key.rb:13-13 | asset:auth_service "Token to UserAuthToken lookup" @ app/models/user_auth_token.rb:145-145 | asset:auth_service "User to TOTP factors" @ app/models/user_second_factor.rb:13-13 | asset:database "Request to ip_address history" @ app/models/user_ip_address_history.rb:7-7 | asset:auth_service "Global API key to key_hash" @ app/models/api_key.rb:26-26 | asset:api "HTTP to session SSO" @ config/routes.rb:594-594 | asset:auth_service "Session to _forum_session cookie" @ config/initializers/100-session_store.rb:5-7 | actor:customer "User create to user stat" @ app/models/user.rb:181-181 | asset:auth_service "Password to validator" @ app/models/user_password.rb:47-48 | asset:auth_service "Email to email token" @ app/models/email_token.rb:3-3

False-positive flows (6): asset:database "User authentication token, IP address, and user-agent metadata -> Discourse PostgreSQL database" @ app/models/user_auth_token.rb:109-120 | asset:database "Rehashed user password credential -> Discourse PostgreSQL database" @ app/models/user_password.rb:65-72 | asset:database "User IP address history -> Discourse PostgreSQL database" @ app/models/user.rb:1148-1155 | asset:database "User visit date and reading activity -> Discourse PostgreSQL database" @ app/models/user.rb:1086-1094 | asset:cache "User last-seen activity marker keyed by user ID and date -> Discourse Redis cache and transient store" @ app/models/user.rb:1189-1197 | asset:service "User-specific notification and private-message summary -> MessageBus realtime delivery service" @ app/models/user.rb:918-931

## discourse / scanner (AI off): misses and false positives

Missed gold components (32): asset:auth_service "UserAuthToken" @ app/models/user_auth_token.rb:4-4 | third_party:auth_provider "Google OAuth2" @ config/site_settings.yml:758-764 | third_party:email_provider "SendGrid" @ config/routes.rb:38-38 | asset:auth_service "EmailToken" @ app/models/email_token.rb:3-3 | asset:auth_service "Oauth2UserInfo" @ app/models/oauth2_user_info.rb:3-3 | asset:auth_service "UserAuthToken" @ app/models/user_auth_token.rb:4-4 | asset:auth_service "UserAuthTokenLog" @ app/models/user_auth_token_log.rb:3-3 | asset:auth_service "UserPassword" @ app/models/user_password.rb:3-3 | asset:api "UsersController" @ config/routes.rb:170-170 | asset:api "SessionController csrf" @ config/routes.rb:598-598 | asset:api "StaticController login" @ config/routes.rb:622-622 | asset:api "Admin::UsersController" @ config/routes.rb:130-130 | asset:auth_service "UserApiKey" @ app/models/user_api_key.rb:3-3 | asset:auth_service "UserSecondFactor" @ app/models/user_second_factor.rb:3-3 | asset:auth_service "EmailLoginCode" @ app/models/email_login_code.rb:3-3

False-positive components (3): actor:employee "Admin User" @ app/models/category.rb:329-329, app/models/concerns/reports/posters_by_member_type.rb:156-156, app/models/report.rb:55-55, app/models/reviewable_user.rb:32-32, app/models/site.rb:178-178, app/models/tag_group.rb:120-120, app/models/tag.rb:157-157, app/models/topic.rb:2274-2274, app/models/user_action.rb:470-470, config/initializers/004-message_bus.rb:60-60 | asset:api "MATCH /auth/:provider/callback" @ config/routes.rb:1349-1349 | asset:api "MATCH /auth/failure" @ config/routes.rb:1346-1346

Missed gold flows (9): asset:database "Email to primary flag" @ app/models/user_email.rb:16-16 | asset:auth_service "Scopes to user API key" @ app/models/user_api_key.rb:13-13 | asset:auth_service "Token to UserAuthToken lookup" @ app/models/user_auth_token.rb:145-145 | asset:auth_service "User to TOTP factors" @ app/models/user_second_factor.rb:13-13 | asset:database "Request to ip_address history" @ app/models/user_ip_address_history.rb:7-7 | asset:auth_service "Global API key to key_hash" @ app/models/api_key.rb:26-26 | asset:auth_service "Password to validator" @ app/models/user_password.rb:47-48 | asset:auth_service "Email to email token" @ app/models/email_token.rb:3-3 | third_party:email_provider "SendGrid to webhook" @ config/routes.rb:38-38

False-positive flows (366): asset:api "API -> MATCH /404" @ config/routes.rb:24-24 | asset:api "API -> MATCH /auth/:provider/callback" @ config/routes.rb:1349-1349 | asset:api "API -> MATCH /auth/failure" @ config/routes.rb:1346-1346 | asset:auth_service "API -> Oauth" @ config/initializers/009-omniauth.rb:6-6, config/initializers/009-omniauth.rb:7-7, config/initializers/009-omniauth.rb:13-13, config/initializers/009-omniauth.rb:14-14, config/initializers/009-omniauth.rb:29-29, config/initializers/009-omniauth.rb:30-30, config/initializers/009-omniauth.rb:34-34, config/initializers/009-omniauth.rb:36-36, config/initializers/009-omniauth.rb:42-42, config/initializers/009-omniauth.rb:45-45, config/initializers/009-omniauth.rb:48-48, config/initializers/009-omniauth.rb:55-55, config/initializers/009-omniauth.rb:58-58 | asset:auth_service "API -> Session" @ config/routes.rb:594-594, config/routes.rb:595-595, config/routes.rb:596-596, config/routes.rb:597-597, config/routes.rb:598-598, config/routes.rb:599-599, config/routes.rb:600-600, config/routes.rb:601-601, config/routes.rb:602-602, config/routes.rb:603-603, config/routes.rb:604-604, config/routes.rb:605-605, config/routes.rb:606-606, config/routes.rb:607-607, config/routes.rb:609-609, config/routes.rb:611-611, config/routes.rb:612-612, config/routes.rb:613-613, config/routes.rb:657-657, config/routes.rb:658-658 | asset:api "Customer -> API" @ app/models/user.rb:3-3 | asset:api "API -> API" @ config/routes.rb:551-565 | actor:customer "Customer -> Customer" @ app/models/user_second_factor.rb:3-3 | actor:customer "Customer -> Customer" @ app/models/user_second_factor.rb:9-9 | actor:customer "Customer -> Customer" @ app/models/user_second_factor.rb:13-13 | actor:customer "Customer -> Customer" @ app/models/user_second_factor.rb:15-15 | actor:customer "Customer -> Customer" @ app/models/user_second_factor.rb:17-17 | actor:customer "Customer -> Customer" @ app/models/user.rb:48-48 | actor:customer "Customer -> Customer" @ app/models/user.rb:52-52 | actor:customer "Customer -> Customer" @ app/models/user.rb:53-53

## Notes

- Assignment change: each authentication surface and each route or controller surface is its own component, one per code location; the "prefer fewer" wording and the per-model database line were removed. Model gpt-6-luna only, thinking high, one run, discourse only. Spend $0.0228 against a $0.10 cap.
- Components by `type:subType`, agent (15): auth_service 7, database 1, cache 1, config 1, api 1, service 1, customer 1, admin 1, email_provider 1. Gold (40): auth_service 18, api 9, config 3, database 2, cache 2, customer 1, third_party 5.
- Compared with the previous run (13 components, 20% precision, 5% recall) component recall rose to 23% and precision to 69%. The agent still lists one `api` component against 9 in gold, so the route-per-location rule was only partly followed; auth_service rose from 2 to 7.
- Flows: 13 reported, 0 matched (gold 16). The scanner has the better flow recall (44%) but 2% precision.
- Merge status: PR #105 was not merged. Its smoke-validation job fails on the known DATAP-748 lint error (`@ts-nocheck` in `tests/fixtures/servicestack-basic/MyApp.Client/src/todos.ts`), which also fails on develop. This results file is committed on the PR branch.
