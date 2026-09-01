# Annotation pass

## Task

KDATAP-a0e80b4a-7703-4425-a056-c1c9b9ef0870 — Adjudicate data items keyed on source field names.

Parent: KDATAP-b0d5e2 (corpus gold migration).

## Scope

All 29 corpus packets under `tests/benchmark/repos/*/annotations/data_items.yaml` (436 rows).

Evidence gathered from pinned source spans and `patterns/personal-data-concept-map.yaml` only. No scanner output used for discovery or accept/reject rationale.

## Migration method

Mechanical labeling pass via `tests/benchmark/scripts/migrate-data-item-gold.ts`:

1. **`candidate.kind: data_item`** — non-scoring proposals with `proposed_identity_key`, `proposed_concept_leaf`, `proposed_ancestry` (Tiers A, B; never on `canonical`).
2. **Legacy keys preserved** — `subject.key`, `subject.name`, `expected.labels`, and `rationale` untouched.
3. **Review demotion** — accepted rows whose suffix matches no closed-map rule/leaf → `review_state: needs_adjudication` (275 flipped).
4. **No self-accept** — writers never set `review_state: accepted`; human acceptance deferred.
5. **Loader** — `data_item_candidate_block` parks proposals as observed-token provenance; does not set `identityAssigned` or promote evaluable positives.

Tiers C/E and category-only labels receive no leaf on `candidate` (adjudication queue only).

## Counts

| Metric | Value |
| --- | ---: |
| Total data-item rows (ledger invariant) | 436 |
| Source-token suffix no map match | 350 |
| Source-token keyed census (suffix ≈ name or unmapped) | 427 |
| Issue reconcile note (~308 measured pre-pass) | 350 unmapped suffixes in current develop corpus |
| Accepted source-token (no map) before → after | 275 → **0** |
| Rows with `candidate.kind: data_item` written | 117 |
| Tier A — suffix maps to rule/leaf | 81 |
| Tier B — label is exact concept_leaf | 36 |
| Tier C — category / unmapped label | 142 |
| Tier D — evidence alias hint | 0 |
| Tier E — never auto-map (id, token, uuid, …) | 43 |
| Negative adjudication | 82 |
| Ambiguous | 52 |

Ledger (short path): `annotations/KDATAP-a0e80b/migration-ledger.json`.

## Human review packet (Ryan)

### Spot-check queues

| Queue | Count | Examples |
| --- | ---: | --- |
| `user_identifier` label, no leaf (Tier C/E) | 55 | `keycloak-user-id` (`data_item:id`) |
| `person_name` label, no leaf | 28 | `discourse-name` (`data_item:name`) |
| Credential / token labels, no ontology leaf | 39 | `auth0-express-access-token-item` |
| Tier B label-guided proposals | 36 | suffix `mail` + label `email_address` |
| Tier A canonical suffix proposals | 81 | `data_item:username` → proposes `data_item:username` |

### Before / after samples

**keycloak `keycloak-user-id`:** `subject.key` stays `data_item:id`; `review_state` `accepted` → `needs_adjudication`; no `candidate` (Tier E).

**keycloak `keycloak-username`:** `subject.key` stays `data_item:username`; `candidate` proposes `data_item:username` / leaf `username`; remains `accepted` (suffix already in map).

**discourse `discourse-user-email` (Tier B):** legacy key `data_item:email` preserved; `candidate` proposes `data_item:email` / `email_address`.

### Accounting

436 in → 436 out. Every row has a ledger entry with `disposition`. No flow or component YAML touched.

## Human review

Pending — Ryan Alyn Porter. Status: **awaiting-review**.
