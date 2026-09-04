# Annotation pass

## Task

KDATAP-8aed54 — Migrate component gold to structured canonical identity.

## Scope

All 29 corpus packets under `tests/benchmark/repos/*/annotations/components.yaml`.

## Migration method

Mechanical assignment per accepted component row:

- **`canonical.identity_key`** — classification identity `${type}:${subtype}` (shared across duplicate legacy repo/key groups; never per-annotation slug).
- **`canonical.entity_id`** — bookkeeping only: `{repoKey}::{annotation.id}` (563 distinct values; never used as `identityKey`).
- **`canonical.component_type` / `canonical.component_subtype`** — from validated `expected.labels[0]`, else taxonomy inference for `third_party` vendor slugs via `known_third_party_names`.
- **`canonical.vendor`** — asserted only on 52 `third_party:*` rows (suffix after `third_party:`).
- Legacy **`subject.key`** and **`subject.name`** retained; loader parks key as `legacy-subject-key` observed token.

No `optionalAssertion.instance` invented. No evidence grouping. No uniquifying `identityKey`.

## Counts

| Metric | Value |
| --- | ---: |
| Accepted component rows migrated | 563 |
| Mechanical type/subtype bucket | 481 |
| Vendor assertion bucket | 52 |
| Actor:user retarget bucket (PR #17) | 30 |
| Distinct `entity_id` values | 563 |
| Discourse `asset:database` shared `identity_key` | 118 rows → `asset:database` |
| Discourse `asset:database` distinct `entity_id` | 118 |

Ledger: `annotations/KDATAP-8aed54/migration-ledger.json`.

## Human review

Pending — Ryan Alyn Porter.
