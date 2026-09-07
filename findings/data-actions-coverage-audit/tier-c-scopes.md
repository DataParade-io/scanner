# Tier C data_actions scopes (post–5.2 / 5.3)

**Date:** 2026-09-07  
**Layer:** `data_actions` (diagnostic)  
**Provenance:** `proposed_by: data-actions-tier-c-agent`  
**Prerequisite:** Tier A/B gold (5.2) + corpus scan/score wiring (5.3)

## Why narrow scopes

Full component exhaustive worlds for Discourse (~122 files) and WordPress (~66 files) are not reviewable for privacy verbs in one pass. Claiming precision on an unreviewed closed world would be dishonest. Each packet’s `data_actions.exhaustive_scope_files` is a **deliberate subset** of (or replacement for) the components scope; evidence paths are required to sit inside that subset.

## Per-packet slices

### Wave 1 — bounded modules

| Packet | Scope strategy | Accepted rows | Notes / exclusions |
| ------ | -------------- | ------------: | ------------------ |
| `drupal` | User-module intersection: entity, storage, login/registration controllers (subset of 12-file component scope) | 7 | Skipped weak password-hash transform on field defs only; NotificationHandler disclose out of narrow slice |
| `nopcommerce` | Same 8 customer/auth component files | 8 | Cookie MFA plugin manager skipped (no clear verb span) |
| `magento` | Subset of `Magento/Customer`: models, resource models, Create/Edit post, AccountManagement, extractor, authentication — **no** `webapi.xml` | 11 | `validateHash` treated as verify, not transform/`use` |

### Wave 2 — CMS capped slices

| Packet | Cap | Scope focus | Accepted rows | Notes / exclusions |
| ------ | --: | ----------- | ------------: | ------------------ |
| `wordpress` | 10 files | User/auth/PII + wpdb/cache/session + PHPMailer/`pluggable` mail | 15 | Stripe/SendGrid/Auth0 component rows are negatives in components gold — not used for disclose |
| `discourse` | 19 files | Identity/PII models + DB/Redis/session store | 26 | Excluded `user.rb` (actor), OmniAuth/`site_settings.yml` weak disclose, SendGrid webhook-only paths |

### Wave 3 — medusa

**SKIP.** All 13 scoped `packages/medusa/src/modules/*` files in the pin are `discoveryPath` / `require.resolve` re-export stubs. No store/disclose call sites in scope. Prefer existing `medusa-customer` model store gold. Widening the pin/sparse-checkout for real Stripe/SendGrid packages needs separate corpus approval.

## Tier C delta

| Metric | Value |
| ------ | ----- |
| Packets annotated | 5 (`drupal`, `nopcommerce`, `magento`, `wordpress`, `discourse`) |
| New accepted `data_actions` positives | **67** |
| Multi-verb subjects (Tier C) | 16 |
| Actor subjects | 0 |
| Asserted `relay` | 0 |
| Medusa | skipped |

Prior Tier A/B floor: 53 accepted / 11 repos. Combined corpus `data_actions` accepted after Tier C: **120** across **16** packets.

## Integrity checks

- Evidence ⊆ narrow `data_actions` scope for every accepted row
- Gold authored from pinned source + PRD — not from `scan()`
- Scorecard-vector/2 unchanged (diagnostic-only)
