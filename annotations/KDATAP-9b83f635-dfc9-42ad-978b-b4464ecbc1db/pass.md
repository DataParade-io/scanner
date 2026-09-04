# Annotation pass — KDATAP-9b83f635-dfc9-42ad-978b-b4464ecbc1db

## Repository / fixture

Five data-item rows across redmine, directus, ghost, pocketbase, strapi:

- `tests/benchmark/repos/redmine/annotations/data_items.yaml`
- `tests/benchmark/repos/directus/annotations/data_items.yaml`
- `tests/benchmark/repos/ghost/annotations/data_items.yaml`
- `tests/benchmark/repos/pocketbase/annotations/data_items.yaml`
- `tests/benchmark/repos/strapi/annotations/data_items.yaml`

Parent epic: KDATAP-b0d5e2. Related packet KDATAP-a0e80b remains **awaiting-review** (436-row pass untouched).

## Scope

Suffix-vs-label adjudication corrections from a0e80b Tier A false accepts. Evidence from pinned source spans and `patterns/personal-data-concept-map.yaml` only. No `scan()` or detector output.

## Findings in this pass

- `KDATAP-9b83f635-dfc9-42ad-978b-b4464ecbc1db` — correct five mis-accepted data-item concept proposals

## Before / after

| id | review_state before → after | candidate before → after |
| --- | --- | --- |
| `redmine-email-address` | accepted → needs_adjudication | Tier A `address` (street) → Tier B `email_address` (`data_item:email`) |
| `directus-user-password` | accepted → needs_adjudication | `password` leaf → withheld |
| `ghost-staff-password-item` | accepted → needs_adjudication | `password` leaf → withheld |
| `pocketbase-password-hash` | accepted → needs_adjudication | `password` leaf → withheld |
| `strapi-user-password` | accepted → needs_adjudication | `password` leaf → withheld |

Legacy `subject.key`, `expected.labels`, and `rationale` unchanged. `password_verifier` is a gold category label, not a concept-map leaf — candidates withheld, not invented.

## Classifier guard

`classifyDataItemRow` now detects suffix-vs-label conflicts (cross-rule and `password_verifier` vs `password` suffix) so a future migrate rerun cannot re-promote wrong Tier A candidates. `applyDataItemMigrationToRecord` clears stale `candidate` when `writeCandidate` is false.

## Human review

Pending — Ryan Alyn Porter. Do not accept until humans adjudicate canonical identity for verifier rows and confirm Redmine email Tier B proposal.
