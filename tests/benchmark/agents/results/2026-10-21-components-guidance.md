# Agent vs scanner pilot (2026-10-21)

Models via Pi: `openai/gpt-6-luna`, thinking=high. Gold (accepted positives): discourse 40 components / 16 flows; vgs-django 2 components / 2 flows.
Price openai/gpt-6-luna: standard tier, USD per 1M tokens input 0.1 / cached 0.01 / output 0.5; source https://developers.openai.com/api/docs/pricing, retrieved 2026-10-20.

## Accuracy and cost side by side

| Repo | Arm | Comp P | Comp R | Flow P | Flow R | Strict comp P / R | Strict flow P / R | Input tok | Cached tok | Output tok | Total cost | Cost / correct comp | Cost / correct flow | Wall time | Requests | Tool calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| discourse | pi + gpt-6-luna (high) | 20% | 5% | 0% | 0% | 20% / 5% | 0% / 0% | 87577 | 1658714 | 15323 | $0.0330 | $0.01650 | n/a (0 correct) | 200.7s | 35 | 62 |
| discourse | scanner (AI off) | 73% | 20% | 2% | 44% | 64% / 18% | 2% / 44% | 0 | 0 | 0 | $0.0000 | $0.00000 | $0.00000 | 104.0s | - | - |
| vgs-django | pi + gpt-6-luna (high) | 67% | 100% | 33% | 50% | 67% / 100% | 33% / 50% | 51057 | 242056 | 12157 | $0.0136 | $0.00680 | $0.01360 | 150.7s | 10 | 34 |
| vgs-django | scanner (AI off) | 50% | 50% | 50% | 50% | 0% / 0% | 0% / 0% | 0 | 0 | 0 | $0.0000 | $0.00000 | $0.00000 | 0.2s | - | - |

Match rule: same kind (component type:subType; for flows, the target's type:subType), same file, line ranges within 10 lines (overlap = 0), one-to-one, names only break ties. Precision is over items with evidence inside the reviewed scope files. The strict columns use the same rule with overlap required (0 lines). Cost per correct = total cost divided by in-scope items matched to a gold label.

| Repo | Arm | Layer | Gold | Items | In scope | Correct (TP, within 10 lines) | Gold found | Strict TP (overlap) |
|---|---|---|---|---|---|---|---|---|
| discourse | pi + gpt-6-luna (high) | components | 40 | 13 | 10 | 2 | 2 | 2 |
| discourse | pi + gpt-6-luna (high) | flows | 16 | 8 | 3 | 0 | 0 | 0 |
| discourse | scanner (AI off) | components | 40 | 15 | 11 | 8 | 8 | 7 |
| discourse | scanner (AI off) | flows | 16 | 444 | 373 | 7 | 7 | 7 |
| vgs-django | pi + gpt-6-luna (high) | components | 2 | 13 | 3 | 2 | 2 | 2 |
| vgs-django | pi + gpt-6-luna (high) | flows | 2 | 8 | 3 | 1 | 1 | 1 |
| vgs-django | scanner (AI off) | components | 2 | 2 | 2 | 1 | 1 | 0 |
| vgs-django | scanner (AI off) | flows | 2 | 4 | 2 | 1 | 1 | 0 |

## Existing identity-key scorer, scanner only (reference)

- discourse components: precision 27%, recall 8%
- discourse data-flows: precision 2%, recall 50%
- vgs-django components: precision 0%, recall 0%
- vgs-django data-flows: precision 0%, recall 0%

## Run notes

- discourse: gpt-6-luna: facts.json valid (13 components, 8 flows); 35 requests, 62 tool calls
- vgs-django: gpt-6-luna: facts.json valid (13 components, 8 flows); 10 requests, 34 tool calls

## discourse / pi + gpt-6-luna (high): misses and false positives

Missed gold components (38): asset:cache "redis" @ config/initializers/001-redis.rb:9-11 | asset:auth_service "UserAuthToken" @ app/models/user_auth_token.rb:4-4 | asset:api "SessionController" @ config/routes.rb:551-551 | asset:api "SiteController" @ config/routes.rb:78-78 | third_party:auth_provider "Google OAuth2" @ config/site_settings.yml:758-764 | third_party:email_provider "SendGrid" @ config/routes.rb:38-38 | actor:customer "User" @ app/models/user.rb:3-3 | asset:auth_service "EmailToken" @ app/models/email_token.rb:3-3 | asset:auth_service "Oauth2UserInfo" @ app/models/oauth2_user_info.rb:3-3 | asset:auth_service "UserAuthToken" @ app/models/user_auth_token.rb:4-4 | asset:auth_service "UserAuthTokenLog" @ app/models/user_auth_token_log.rb:3-3 | asset:auth_service "UserPassword" @ app/models/user_password.rb:3-3 | asset:api "UsersController" @ config/routes.rb:170-170 | asset:api "SessionController csrf" @ config/routes.rb:598-598 | asset:api "StaticController login" @ config/routes.rb:622-622

False-positive components (8): asset:api "Discourse Rails API" @ config/routes.rb:645-650, config/routes.rb:1136-1148 | asset:config "Discourse runtime configuration" @ config/database.yml:8-21, config/discourse_defaults.conf:234-247 | asset:auth_service "Discourse Connect SSO service" @ app/models/discourse_connect.rb:10-27, config/routes.rb:594-596 | asset:service "MessageBus real-time messaging" @ config/initializers/004-message_bus.rb:140-150, app/models/user.rb:884-931 | actor:customer "Community member" @ README.md:13-23, config/routes.rb:645-650 | actor:admin "Site administrator" @ config/routes.rb:98-110 | third_party:auth_provider "Configured Discourse Connect identity provider" @ app/models/discourse_connect.rb:10-27, config/routes.rb:594-596 | third_party:saas_service "AWS S3 object storage" @ Gemfile:64-64, config/discourse_defaults.conf:234-247, config/routes.rb:1140-1148

Missed gold flows (16): asset:auth_service "Session store to cookie" @ config/initializers/100-session_store.rb:5-7 | asset:api "Admin::UsersController HTTP route" @ config/routes.rb:130-130 | asset:api "WebhooksController mailgun HTTP route" @ config/routes.rb:32-32 | actor:customer "User to user_password" @ app/models/user.rb:84-84 | asset:database "Email to primary flag" @ app/models/user_email.rb:16-16 | asset:auth_service "Scopes to user API key" @ app/models/user_api_key.rb:13-13 | asset:auth_service "Token to UserAuthToken lookup" @ app/models/user_auth_token.rb:145-145 | asset:auth_service "User to TOTP factors" @ app/models/user_second_factor.rb:13-13 | asset:database "Request to ip_address history" @ app/models/user_ip_address_history.rb:7-7 | asset:auth_service "Global API key to key_hash" @ app/models/api_key.rb:26-26 | asset:api "HTTP to session SSO" @ config/routes.rb:594-594 | asset:auth_service "Session to _forum_session cookie" @ config/initializers/100-session_store.rb:5-7 | actor:customer "User create to user stat" @ app/models/user.rb:181-181 | asset:auth_service "Password to validator" @ app/models/user_password.rb:47-48 | asset:auth_service "Email to email token" @ app/models/email_token.rb:3-3

False-positive flows (3): asset:database "Authentication token and login metadata -> PostgreSQL database" @ app/models/user_auth_token.rb:109-131 | asset:service "Staff login alert (user ID, client IP, and user agent) -> Sidekiq background job queue" @ app/models/user_auth_token.rb:133-139 | asset:service "User notification state and personal-message notification counts -> MessageBus real-time messaging" @ app/models/user.rb:918-931

## discourse / scanner (AI off): misses and false positives

Missed gold components (32): asset:auth_service "UserAuthToken" @ app/models/user_auth_token.rb:4-4 | third_party:auth_provider "Google OAuth2" @ config/site_settings.yml:758-764 | third_party:email_provider "SendGrid" @ config/routes.rb:38-38 | asset:auth_service "EmailToken" @ app/models/email_token.rb:3-3 | asset:auth_service "Oauth2UserInfo" @ app/models/oauth2_user_info.rb:3-3 | asset:auth_service "UserAuthToken" @ app/models/user_auth_token.rb:4-4 | asset:auth_service "UserAuthTokenLog" @ app/models/user_auth_token_log.rb:3-3 | asset:auth_service "UserPassword" @ app/models/user_password.rb:3-3 | asset:api "UsersController" @ config/routes.rb:170-170 | asset:api "SessionController csrf" @ config/routes.rb:598-598 | asset:api "StaticController login" @ config/routes.rb:622-622 | asset:api "Admin::UsersController" @ config/routes.rb:130-130 | asset:auth_service "UserApiKey" @ app/models/user_api_key.rb:3-3 | asset:auth_service "UserSecondFactor" @ app/models/user_second_factor.rb:3-3 | asset:auth_service "EmailLoginCode" @ app/models/email_login_code.rb:3-3

False-positive components (3): actor:employee "Admin User" @ app/models/category.rb:329-329, app/models/concerns/reports/posters_by_member_type.rb:156-156, app/models/report.rb:55-55, app/models/reviewable_user.rb:32-32, app/models/site.rb:178-178, app/models/tag_group.rb:120-120, app/models/tag.rb:157-157, app/models/topic.rb:2274-2274, app/models/user_action.rb:470-470, config/initializers/004-message_bus.rb:60-60 | asset:api "MATCH /auth/:provider/callback" @ config/routes.rb:1349-1349 | asset:api "MATCH /auth/failure" @ config/routes.rb:1346-1346

Missed gold flows (9): asset:database "Email to primary flag" @ app/models/user_email.rb:16-16 | asset:auth_service "Scopes to user API key" @ app/models/user_api_key.rb:13-13 | asset:auth_service "Token to UserAuthToken lookup" @ app/models/user_auth_token.rb:145-145 | asset:auth_service "User to TOTP factors" @ app/models/user_second_factor.rb:13-13 | asset:database "Request to ip_address history" @ app/models/user_ip_address_history.rb:7-7 | asset:auth_service "Global API key to key_hash" @ app/models/api_key.rb:26-26 | asset:auth_service "Password to validator" @ app/models/user_password.rb:47-48 | asset:auth_service "Email to email token" @ app/models/email_token.rb:3-3 | third_party:email_provider "SendGrid to webhook" @ config/routes.rb:38-38

False-positive flows (366): asset:api "API -> MATCH /404" @ config/routes.rb:24-24 | asset:api "API -> MATCH /auth/:provider/callback" @ config/routes.rb:1349-1349 | asset:api "API -> MATCH /auth/failure" @ config/routes.rb:1346-1346 | asset:auth_service "API -> Oauth" @ config/initializers/009-omniauth.rb:6-6, config/initializers/009-omniauth.rb:7-7, config/initializers/009-omniauth.rb:13-13, config/initializers/009-omniauth.rb:14-14, config/initializers/009-omniauth.rb:29-29, config/initializers/009-omniauth.rb:30-30, config/initializers/009-omniauth.rb:34-34, config/initializers/009-omniauth.rb:36-36, config/initializers/009-omniauth.rb:42-42, config/initializers/009-omniauth.rb:45-45, config/initializers/009-omniauth.rb:48-48, config/initializers/009-omniauth.rb:55-55, config/initializers/009-omniauth.rb:58-58 | asset:auth_service "API -> Session" @ config/routes.rb:594-594, config/routes.rb:595-595, config/routes.rb:596-596, config/routes.rb:597-597, config/routes.rb:598-598, config/routes.rb:599-599, config/routes.rb:600-600, config/routes.rb:601-601, config/routes.rb:602-602, config/routes.rb:603-603, config/routes.rb:604-604, config/routes.rb:605-605, config/routes.rb:606-606, config/routes.rb:607-607, config/routes.rb:609-609, config/routes.rb:611-611, config/routes.rb:612-612, config/routes.rb:613-613, config/routes.rb:657-657, config/routes.rb:658-658 | asset:api "Customer -> API" @ app/models/user.rb:3-3 | asset:api "API -> API" @ config/routes.rb:551-565 | actor:customer "Customer -> Customer" @ app/models/user_second_factor.rb:3-3 | actor:customer "Customer -> Customer" @ app/models/user_second_factor.rb:9-9 | actor:customer "Customer -> Customer" @ app/models/user_second_factor.rb:13-13 | actor:customer "Customer -> Customer" @ app/models/user_second_factor.rb:15-15 | actor:customer "Customer -> Customer" @ app/models/user_second_factor.rb:17-17 | actor:customer "Customer -> Customer" @ app/models/user.rb:48-48 | actor:customer "Customer -> Customer" @ app/models/user.rb:52-52 | actor:customer "Customer -> Customer" @ app/models/user.rb:53-53

## vgs-django / pi + gpt-6-luna (high): misses and false positives

Missed gold components (0): none

False-positive components (1): asset:service "Checkr integration service" @ app/checker_client.py:18-48, app/views.py:57-76

Missed gold flows (1): asset:database "PiiData to database" @ app/models.py:4-6

False-positive flows (2): third_party:saas_service "Candidate SSN and driver license number -> Checkr" @ app/checker_client.py:25-48, idVerification/settings.py:32-32 | asset:api "Checkr screening report -> Application HTTP API" @ app/checker_client.py:101-125, app/views.py:75-81

## vgs-django / scanner (AI off): misses and false positives

Missed gold components (1): third_party:saas_service "Checkr" @ app/checker_client.py:44-48

False-positive components (1): asset:api "Requests Call" @ app/checker_client.py:44-44, app/checker_client.py:61-61, app/checker_client.py:73-73, app/checker_client.py:90-90, app/checker_client.py:109-109

Missed gold flows (1): third_party:saas_service "PII to Checkr candidates API" @ app/checker_client.py:38-48

False-positive flows (1): asset:database "Requests Call -> Django Model Class" @ app/migrations/0001_initial.py:3-3, app/models.py:1-1

## What changed in the agent's output (components by `type:subType`)

Discourse, gold (40): asset:auth_service 18, asset:api 9, asset:config 3, asset:database 2, asset:cache 2, actor:customer 1, third_party 5 (one each: two e-mail/auth-style providers and three social logins, keyed by vendor in gold).
- Before the guidance (luna, high): 48 components, 33 of them asset:database, 7 third_party:email_provider, 3 asset:service, 1 each of customer, admin, api, saas_service, cache. Matched 4.
- After the guidance (luna, high): 13 components: asset:service 2, asset:auth_service 2, and one each of api, database, cache, config, customer, admin, third_party auth_provider, saas_service, email_provider. Matched 2 (precision 20%, recall 5%).

vgs-django, gold (2): asset:database 1, third_party 1 (Checkr).
- After the guidance: 13 components: asset:service 3, third_party:saas_service 3, asset:api 2, and one each of auth_service, database, config, customer, admin. Matched both gold components (recall 100%), precision 67% on the 3 in-scope items.

Reading the table:
- The database over-splitting is gone (33 and 63 per-model databases down to 1), so the granularity rule worked.
- The agent now lists one component per type and stops: it found 2 auth_service and 1 api component on discourse against 18 and 9 in gold. "Prefer fewer" and "one per mechanism" were read very conservatively, and gold wants one auth_service or api component per code location (a token class, a session store, each route). That granularity is not stated in the assignment and is the likely next thing to change.
- Flows: discourse still 0 of 16; vgs-django 1 of 2 (precision 33%).
- Spend for this step: about $0.047 (discourse $0.033, vgs-django $0.014). Model gpt-6-luna only; refusal path tested first (non-luna id exits with code 1 before any API call).
