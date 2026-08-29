# Eval gold flywheel

Agent-authored ground truth stays **proposed** until a person reviews it. Kanbus tracks that review with two issue types on the main KDATAP board.

## Types

| Type | What it names | Starts as | Human gate |
| --- | --- | --- | --- |
| `finding` | One detection we expect (or expect not) to see | `proposed` (create hook) | A person advances it off `proposed` |
| `annotation` | One labeling pass over a fixture or corpus repo | `labeling` (create hook) | A person moves `awaiting-review` → `accepted` |

Do not file five layer sub-tasks for a finding. Decompose in `findings/<id>/decomposition.md`.

## Ladders

Finding: `open → proposed → decomposed → gold-authored → verified → closed`

Annotation: `open → labeling → awaiting-review → accepted` (or `rejected` back to `labeling`)

Hooks only check that the Markdown artifact is non-empty and not the scaffold placeholder. They do not run `scan()` or `eval:suite`.

## Artifacts

- `findings/<id>/proposal.md` — required before `decomposed`
- `findings/<id>/decomposition.md` — required before `gold-authored` / `verified`
- `annotations/<id>/pass.md` — required before `awaiting-review` / `accepted`

These Markdown files are the flywheel record. Edit them. Do not edit `project/issues` JSON.

## Existing gold waiting on review

Jest cases in `tests/eval/layers/*/cases.ts` are agent-proposed. Each fixture below has an annotation issue; each distinct detection has a finding. Until a person accepts the annotation, treat that gold as proposed, not corpus-accepted.
