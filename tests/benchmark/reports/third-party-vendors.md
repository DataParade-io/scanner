# Third-party vendor report

Version `third-party-report/1`. Review states counted: accepted, proposed, needs_adjudication. Recall counts a vendor only when the scanner reports it at a labelled manifest entry, import or call site; vendor recall counts it wherever it is reported; certain recall leaves out labels marked uncertain. Precision is vendor level, over in-scope predictions. Declared dependencies that send no data are listed apart and not scored.

| Packet | Gold | Predicted | Recall | Certain recall | Vendor recall | Precision | No SDK mapping | Raw HTTP missed | Provenance wrong | Declared only (reported) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| auth0-express | 1 | 0 | 0.0% | n/a | 0.0% | n/a | 1 | 0 | 0 | 0 (0) |
| calcom | 19 | 9 | 31.6% | 37.5% | 31.6% | 66.7% | 9 | 4 | 0 | 1 (0) |
| chatwoot | 48 | 4 | 6.3% | 6.7% | 6.3% | 75.0% | 19 | 26 | 0 | 0 (0) |
| directus | 15 | 5 | 26.7% | 26.7% | 26.7% | 80.0% | 10 | 1 | 0 | 0 (0) |
| discourse | 10 | 0 | 0.0% | 0.0% | 0.0% | n/a | 7 | 3 | 0 | 1 (0) |
| drupal | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 (0) |
| easy-school | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 (0) |
| exposed | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 (0) |
| flask-login | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 (0) |
| ghost | 16 | 5 | 25.0% | 26.7% | 31.3% | 100.0% | 3 | 8 | 1 | 0 (0) |
| gitea | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 (0) |
| hyperswitch-vault | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 (0) |
| jarviscore | 4 | 4 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 | 0 (0) |
| keycloak | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 (0) |
| magento | 1 | 0 | 0.0% | 0.0% | 0.0% | n/a | 0 | 1 | 0 | 0 (0) |
| marketmenow | 4 | 4 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 | 0 (0) |
| medusa-customer | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 (0) |
| nopcommerce | 30 | 3 | 6.7% | 7.1% | 6.7% | 66.7% | 15 | 13 | 0 | 0 (0) |
| omni-ai-automation | 5 | 5 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 | 0 (0) |
| orchard-core | 5 | 1 | 20.0% | 25.0% | 20.0% | 100.0% | 2 | 2 | 0 | 0 (0) |
| ory-kratos-password | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 (0) |
| pocketbase | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 (0) |
| redmine | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 (0) |
| saleor | 1 | 1 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 | 0 (0) |
| scanner-fixtures-cross-file | 6 | 6 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 | 0 (0) |
| scanner-fixtures-kwargs | 3 | 3 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 | 0 (0) |
| scanner-fixtures-passthrough | 2 | 2 | 0.0% | 0.0% | 100.0% | 100.0% | 0 | 0 | 2 | 0 (0) |
| scanner-fixtures-sdk-names | 4 | 4 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 | 0 (0) |
| scanner-fixtures-typescript | 4 | 4 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 | 0 (0) |
| scanner-fixtures | 9 | 9 | 100.0% | 100.0% | 100.0% | 100.0% | 0 | 0 | 0 | 0 (0) |
| spree | 2 | 0 | 0.0% | n/a | 0.0% | n/a | 1 | 1 | 0 | 0 (0) |
| spring-petclinic | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 (0) |
| strapi | 6 | 2 | 33.3% | 40.0% | 33.3% | 100.0% | 3 | 1 | 0 | 0 (0) |
| supabase-js | 1 | 2 | 100.0% | 100.0% | 100.0% | 50.0% | 0 | 0 | 0 | 0 (0) |
| vapor | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 | 0 | 0 (0) |
| vgs-django | 2 | 0 | 0.0% | 0.0% | 0.0% | n/a | 0 | 2 | 0 | 0 (0) |
| wordpress | 36 | 0 | 0.0% | 0.0% | 0.0% | n/a | 0 | 36 | 0 | 0 (0) |
| **All** | 234 | 73 | 26.9% | 29.1% | 28.2% | 90.4% | 70 | 98 | 3 | 2 (0) |

## Misses and false positives

### auth0-express

- miss `third_party:auth0` (sdk): no_sdk_mapping, label uncertain

### calcom

- miss `third_party:trigger_dev` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:upstash` (sdk): no_sdk_mapping
- miss `third_party:dub` (sdk): no_sdk_mapping
- miss `third_party:google_auth` (sdk): no_sdk_mapping
- miss `third_party:google_calendar` (sdk): no_sdk_mapping
- miss `third_party:azure_ad` (sdk): no_sdk_mapping
- miss `third_party:microsoft_graph` (raw_http): raw_http_missed
- miss `third_party:formbricks` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:unkey` (sdk): no_sdk_mapping
- miss `third_party:lingo_dev` (sdk): no_sdk_mapping
- miss `third_party:ui_avatars` (raw_http): raw_http_missed
- miss `third_party:resend` (raw_http): raw_http_missed
- miss `third_party:retell_ai` (raw_http): raw_http_missed, label uncertain
- false positive `third_party:googleapis`
- false positive `third_party:microsoft`
- false positive `third_party:stripe`

### chatwoot

- miss `third_party:facebook_graph` (sdk): no_sdk_mapping
- miss `third_party:instagram` (raw_http): raw_http_missed
- miss `third_party:whatsapp` (raw_http): raw_http_missed
- miss `third_party:360dialog` (raw_http): raw_http_missed
- miss `third_party:x` (sdk): no_sdk_mapping
- miss `third_party:telegram` (raw_http): raw_http_missed
- miss `third_party:line` (sdk): no_sdk_mapping
- miss `third_party:tiktok` (raw_http): raw_http_missed
- miss `third_party:twilio` (both): no_sdk_mapping
- miss `third_party:bandwidth` (raw_http): raw_http_missed
- miss `third_party:gmail` (raw_http): raw_http_missed
- miss `third_party:microsoft` (raw_http): raw_http_missed
- miss `third_party:google_auth` (sdk): no_sdk_mapping
- miss `third_party:slack` (sdk): no_sdk_mapping
- miss `third_party:google_dialogflow` (sdk): no_sdk_mapping
- miss `third_party:google_translate` (sdk): no_sdk_mapping
- miss `third_party:openai` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:openrouter` (raw_http): raw_http_missed
- miss `third_party:langfuse` (sdk): no_sdk_mapping
- miss `third_party:linear` (raw_http): raw_http_missed
- miss `third_party:notion` (raw_http): raw_http_missed
- miss `third_party:shopify` (both): no_sdk_mapping
- miss `third_party:leadsquared` (raw_http): raw_http_missed
- miss `third_party:intercom` (raw_http): raw_http_missed
- miss `third_party:freshdesk` (raw_http): raw_http_missed
- miss `third_party:cloudflare` (raw_http): raw_http_missed
- miss `third_party:firebase` (sdk): no_sdk_mapping
- miss `third_party:chatwoot_hub` (raw_http): raw_http_missed
- miss `third_party:gravatar` (raw_http): raw_http_missed
- miss `third_party:google_favicon` (raw_http): raw_http_missed
- miss `third_party:maxmind` (raw_http): raw_http_missed
- miss `third_party:google_cloud_storage` (sdk): no_sdk_mapping
- miss `third_party:azure` (sdk): no_sdk_mapping
- miss `third_party:datadog` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:elastic_apm` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:scout_apm` (sdk): no_sdk_mapping
- miss `third_party:newrelic` (sdk): no_sdk_mapping
- miss `third_party:judoscale` (sdk): no_sdk_mapping
- miss `third_party:google_analytics` (raw_http): raw_http_missed
- miss `third_party:google_tag_manager` (raw_http): raw_http_missed
- miss `third_party:hotjar` (raw_http): raw_http_missed
- miss `third_party:plausible` (raw_http): raw_http_missed
- miss `third_party:amplitude` (raw_http): raw_http_missed
- miss `third_party:microsoft_clarity` (raw_http): raw_http_missed
- miss `third_party:meta_pixel` (raw_http): raw_http_missed
- false positive `third_party:stripe`

### directus

- miss `third_party:google_gemini` (both): no_sdk_mapping
- miss `third_party:langfuse` (sdk): no_sdk_mapping
- miss `third_party:braintrust` (sdk): no_sdk_mapping
- miss `third_party:mailgun` (sdk): no_sdk_mapping
- miss `third_party:mailtrap` (sdk): no_sdk_mapping
- miss `third_party:google_cloud_storage` (sdk): no_sdk_mapping
- miss `third_party:azure` (sdk): no_sdk_mapping
- miss `third_party:cloudinary` (sdk): no_sdk_mapping
- miss `third_party:netlify` (sdk): no_sdk_mapping
- miss `third_party:vercel` (raw_http): raw_http_missed
- miss `third_party:directus` (both): no_sdk_mapping
- false positive `third_party:google_ai`

### discourse

- miss `third_party:gravatar` (raw_http): raw_http_missed
- miss `third_party:aws` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:google_auth` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:github_auth` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:twitter_auth` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:facebook_auth` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:discord_auth` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:linkedin_auth` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:discourse_hub` (raw_http): raw_http_missed, label uncertain
- miss `third_party:maxmind` (raw_http): raw_http_missed, label uncertain

### ghost

- miss `third_party:mailgun` (sdk): no_sdk_mapping
- miss `third_party:slack` (raw_http): raw_http_missed
- miss `third_party:tinybird` (raw_http): raw_http_missed
- miss `third_party:geojs` (raw_http): raw_http_missed
- miss `third_party:gravatar` (raw_http): raw_http_missed
- miss `third_party:jsdelivr` (raw_http): raw_http_missed
- miss `third_party:twitter` (both): provenance_wrong
- miss `third_party:opensea` (raw_http): raw_http_missed
- miss `third_party:indexnow` (raw_http): raw_http_missed
- miss `third_party:github` (raw_http): raw_http_missed
- miss `third_party:xpay` (sdk): no_sdk_mapping
- miss `third_party:tempo` (sdk): no_sdk_mapping, label uncertain

### magento

- miss `third_party:eu_vies` (raw_http): raw_http_missed

### nopcommerce

- miss `third_party:nopcommerce` (raw_http): raw_http_missed
- miss `third_party:github` (raw_http): raw_http_missed
- miss `third_party:hmrc` (raw_http): raw_http_missed
- miss `third_party:eu_vies` (raw_http): raw_http_missed
- miss `third_party:openai` (raw_http): raw_http_missed
- miss `third_party:google_gemini` (raw_http): raw_http_missed
- miss `third_party:deepseek` (raw_http): raw_http_missed
- miss `third_party:deepl` (sdk): no_sdk_mapping
- miss `third_party:google_translate` (sdk): no_sdk_mapping
- miss `third_party:google_recaptcha` (raw_http): raw_http_missed
- miss `third_party:gmail` (sdk): no_sdk_mapping
- miss `third_party:microsoft_365` (sdk): no_sdk_mapping
- miss `third_party:google_maps` (sdk): no_sdk_mapping
- miss `third_party:sharethis` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:apple_pay` (sdk): no_sdk_mapping
- miss `third_party:google_pay` (sdk): no_sdk_mapping
- miss `third_party:brevo` (both): no_sdk_mapping
- miss `third_party:avalara` (both): no_sdk_mapping
- miss `third_party:ups` (raw_http): raw_http_missed
- miss `third_party:zettle` (raw_http): raw_http_missed
- miss `third_party:omnisend` (raw_http): raw_http_missed
- miss `third_party:cloudflare` (raw_http): raw_http_missed
- miss `third_party:azure` (sdk): no_sdk_mapping
- miss `third_party:facebook_login` (sdk): no_sdk_mapping
- miss `third_party:facebook_pixel` (both): no_sdk_mapping
- miss `third_party:google_analytics` (both): no_sdk_mapping
- miss `third_party:jotform` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:ecb` (raw_http): raw_http_missed
- false positive `third_party:google_identity`

### orchard-core

- miss `third_party:azure` (sdk): no_sdk_mapping
- miss `third_party:elasticsearch` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:google_recaptcha` (raw_http): raw_http_missed
- miss `third_party:twilio` (raw_http): raw_http_missed

### scanner-fixtures-passthrough

- miss `third_party:openrouter` (sdk): provenance_wrong
- miss `third_party:cerebras` (sdk): provenance_wrong

### spree

- miss `third_party:nominatim` (sdk): no_sdk_mapping, label uncertain
- miss `third_party:google_fonts` (raw_http): raw_http_missed, label uncertain

### strapi

- miss `third_party:strapi` (both): no_sdk_mapping
- miss `third_party:npm` (sdk): no_sdk_mapping
- miss `third_party:jsdelivr` (raw_http): raw_http_missed
- miss `third_party:mux` (sdk): no_sdk_mapping, label uncertain

### supabase-js

- false positive `third_party:openai`

### vgs-django

- miss `third_party:checkr` (raw_http): raw_http_missed
- miss `third_party:vgs` (raw_http): raw_http_missed

### wordpress

- miss `third_party:wordpress_org` (raw_http): raw_http_missed
- miss `third_party:gravatar` (raw_http): raw_http_missed
- miss `third_party:google_fonts` (raw_http): raw_http_missed, label uncertain
- miss `third_party:google_hosted_libraries` (raw_http): raw_http_missed, label uncertain
- miss `third_party:youtube` (raw_http): raw_http_missed
- miss `third_party:vimeo` (raw_http): raw_http_missed
- miss `third_party:dailymotion` (raw_http): raw_http_missed
- miss `third_party:flickr` (raw_http): raw_http_missed
- miss `third_party:smugmug` (raw_http): raw_http_missed
- miss `third_party:scribd` (raw_http): raw_http_missed
- miss `third_party:wordpress_tv` (raw_http): raw_http_missed
- miss `third_party:crowdsignal` (raw_http): raw_http_missed
- miss `third_party:twitter` (raw_http): raw_http_missed
- miss `third_party:soundcloud` (raw_http): raw_http_missed
- miss `third_party:spotify` (raw_http): raw_http_missed
- miss `third_party:imgur` (raw_http): raw_http_missed
- miss `third_party:issuu` (raw_http): raw_http_missed
- miss `third_party:mixcloud` (raw_http): raw_http_missed
- miss `third_party:ted` (raw_http): raw_http_missed
- miss `third_party:animoto` (raw_http): raw_http_missed
- miss `third_party:tumblr` (raw_http): raw_http_missed
- miss `third_party:kickstarter` (raw_http): raw_http_missed
- miss `third_party:cloudup` (raw_http): raw_http_missed
- miss `third_party:reverbnation` (raw_http): raw_http_missed
- miss `third_party:videopress` (raw_http): raw_http_missed
- miss `third_party:reddit` (raw_http): raw_http_missed
- miss `third_party:speakerdeck` (raw_http): raw_http_missed
- miss `third_party:amazon_kindle` (raw_http): raw_http_missed
- miss `third_party:someecards` (raw_http): raw_http_missed
- miss `third_party:tiktok` (raw_http): raw_http_missed
- miss `third_party:pinterest` (raw_http): raw_http_missed
- miss `third_party:wolfram_cloud` (raw_http): raw_http_missed
- miss `third_party:pocket_casts` (raw_http): raw_http_missed
- miss `third_party:anghami` (raw_http): raw_http_missed
- miss `third_party:bluesky` (raw_http): raw_http_missed
- miss `third_party:canva` (raw_http): raw_http_missed
