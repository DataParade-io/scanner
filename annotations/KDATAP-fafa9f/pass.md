# Annotation pass

## Task

KDATAP-fafa9f — Migrate mention gold to canonical keys and observed-token candidates.

Parent: KDATAP-b0d5e2 (corpus gold migration).

## Scope

All 29 corpus packets under `tests/benchmark/repos/`.

## Migration method

Mechanical one-shot script `tests/benchmark/scripts/migrate-mention-gold.ts`:

1. Rename `annotations/pii_signals.yaml` → `annotations/mentions.yaml`
2. Set `layer: mentions` on every row
3. **Tier A (97 rows):** suffix is a `concept_leaf` with exactly one `rule_id` in `patterns/personal-data-concept-map.yaml` → rewrite `subject.key` to `mention:<rule_id>`
4. **Bookmark adjudication (260 rows):** forbidden category or unmapped suffix → `mention:<taxonomy_suffix>` + `review_state: needs_adjudication` + `legacy-key:pii:<suffix>` in `expected.labels`
5. **Tier A negative adjudication (18 rows):** Tier A suffix but `expected.status: negative` + `review_state: accepted` → key rewrite only, `review_state: needs_adjudication`
6. Preserve every `subject.name` in YAML (observed-token candidate at load; never selects identity)
7. Evidence validation ledger: `subject.name` checked against pinned commit span (verified / unverified / skipped when clone absent)
8. Manifest `coverage.layers`: `pii_signals` → `mentions`; `annotation_version` incremented

## Counts (pre-migration corpus)

| Bucket | Count |
| --- | ---: |
| Total mention rows | 357 |
| Tier A accepted (mechanical key + accepted) | 79 |
| Tier A negative → needs_adjudication | 18 |
| Bookmark / category / unmapped → needs_adjudication | 260 |
| **Total needs_adjudication** | **278** |

### Tier A key targets (97 rows)

| Former suffix | New key | Rows |
| --- | --- | ---: |
| `email_address` | `mention:email` | 67 |
| `phone_number` | `mention:phone_number` | 17 |
| `date_of_birth` | `mention:date_of_birth` | 7 |
| `password` | `mention:password` | 6 |

## Loader changes (post-migration)

- `loadAnnotations` reads `mentions.yaml` only (no `pii_signals.yaml` fallback)
- Corpus rejects `pii:` subject keys at validation
- `piiMentionKeyExemption` deleted from compat loader

## Human review

Accepted. Mechanical migration preserves legacy names as observed-token candidates; suspicious and category rows routed to adjudication rather than canonical copy.
