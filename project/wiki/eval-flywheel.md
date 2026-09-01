# Eval gold flywheel

Agent-authored ground truth stays **proposed** until a person reviews it. Kanbus tracks that review with two issue types on the main KDATAP board.

## Types

| Type | What it names | Starts as | Human gate |
| --- | --- | --- | --- |
| `finding` | One detection we expect (or expect not) to see | `proposed` (create hook) | A person advances it off `proposed` |
| `annotation` | One labeling pass over a fixture or corpus repo | `labeling` (create hook) | A person moves `awaiting-review` → `accepted` |

Do not file per-layer sub-tasks for a finding. Decompose in `findings/<id>/decomposition.md`.

## Ladders

Finding: `open → proposed → decomposed → gold-authored → verified → closed`

Annotation: `open → labeling → awaiting-review → accepted` (or `rejected` back to `labeling`)

Hooks only check that the Markdown artifact is non-empty and not the scaffold placeholder. They do not run `scan()` or `eval:suite`.

## Artifacts

- `findings/<id>/proposal.md` — required before `decomposed`
- `findings/<id>/decomposition.md` — required before `gold-authored` / `verified`
- `annotations/<id>/pass.md` — required before `awaiting-review` / `accepted`

These Markdown files are the flywheel record. Edit them. Do not edit `project/issues` JSON.

## Accepted fixture gold

Ryan accepted the six fixture annotation passes. Findings on those fixtures are **verified** (including the java Stripe and Terraform Lambda→DB detections filed after review). Jest cases in `tests/eval/layers/*/cases.ts` are corpus-accepted for those fixtures.

Those passes now set `exhaustiveScopeFiles` so precision is computed. Scanner findings in the reviewed files that do not match an accepted **positive** are false positives. We do not file a negative for “this repo has no Stripe”; extra Stripe hits in an exhaustive file lower precision automatically.

Phantom python drivers (`aiosqlite`, `asyncpg`, `pymysql` on a `psycopg2` file) and locationless `actor:user` extras are left ungolded so they hurt precision.

Passport and Terraform address negatives include both the original weak tokens (`passport.authenticate`, `.address`) and nearer-miss tokens (`passport_strategy`, `bind_address`). Those still do not match the current PII patterns (`passport_number`, `street_address`, and kin); they document the intended boundary, they do not prove the matcher rejects a token it could fire on.
