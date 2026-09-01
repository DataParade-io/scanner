# Annotation pass

## Task

KDATAP-a49e94 — Correct two flow candidate mis-buckets from GLM review.

Parent: KDATAP-8e7756 (flow regold; stays in `labeling` until Ryan re-accepts after merge).

## Scope

Two rows in corpus flow gold only:

- `tests/benchmark/repos/saleor/annotations/data_flows.yaml` — `saleor-user-email-persisted`
- `tests/benchmark/repos/wordpress/annotations/data_flows.yaml` — `wordpress-signon-to-auth-cookie`

No scanner runs. No `review_state: accepted`. KDATAP-8e7756 ledger/census unchanged.

## Correction method

Human adjudication of GLM advisory on mechanical KDATAP-8e7756 proposals (corpus skill: Correct ground truth).

Classifier guard added in `tests/eval/canonical/compat/flow-migration.ts`: negative components excluded from flow overlap/rationale candidate matching to prevent wordpress-signon rerun regression.

## Inversion table

| Row | Packet | Defect | Before | After |
| --- | --- | --- | --- | --- |
| `saleor-user-email-persisted` | saleor | False cross-component graph edge on single ORM class | `graph_edge` → actor→database | `intra_component_lineage` → `saleor-customer-actor` same entity |
| `wordpress-signon-to-auth-cookie` | wordpress | Flow attributed to negative `wordpress-not-stripe` decoy | `intra_component_lineage` on `wordpress-not-stripe` | `intra_component_lineage` on `wordpress-auth-cookie-service` |

**Bucket delta (436 rows):** `graph_edge` 1→0, `intra_component_lineage` 184→185.

## Digest

| Pin | Value |
| --- | --- |
| Before | `sha256:ac586befc5fdaf3ed29317ad0f1825df387159df9825b00a4e2081a0a5b14e88` |
| After | `sha256:8c9fdeca8be7d7d64e778b7ad7c87c4f76bf1d4eb06acc85aee09a76b987e543` |

## Human review

Awaiting review — Ryan re-accepts KDATAP-8e7756 flow worksheet after merge.
