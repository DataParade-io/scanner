# Annotation pass — KDATAP-da54f5

## Task

KDATAP-da54f5 — Run the gold labeling annotation pass over the sentiment fixture corpus.

Parent: KDATAP-d59959 (Privacy, gold eval, and release readiness).

## Scope

Every human-authored fixture message under `tests/fixtures/sentiment/` after
dedup (forked copies and mirror records collapse to one row):

| # | Source | Text (fixture, synthetic) | Gold label |
|---|--------|---------------------------|------------|
| 1 | claude-code | `thanks for the fix` | thanks |
| 2 | claude-code | `looks fuckin great, thanks` | both |
| 3 | claude-code | `queued follow-up\nsecond block` (human-origin queued command) | neither |
| 4 | cursor-agent | `thanks that worked` | thanks |
| 5 | codex | `thanks, this works` | thanks |
| 6 | codex | `now fuck this linter into shape` | fbomb |
| 7 | codex | `one more thing, thanks` | thanks |

Non-human or injected fixture content (assistant replies, `tool_result`
blocks, `isMeta`, sidechains, system-reminder/task-notification wrappers,
slash-command envelopes, harness-injected Codex user items) is excluded by
the adapters and carries no gold label — it must never reach the counter.

Labels: `thanks`, `fbomb`, `both`, `neither`, `excluded`.

## Method

Deterministic: labels come from the counting rules in
`src/sentiment/counting.ts` applied to the stripped message text. The gate is
exact match (100 percent) on synthetic fixtures, enforced by
`tests/unit/sentiment/gold-eval.spec.ts`.

## Contested labels

None. No findings filed for this pass. If a real-corpus pass (Ryan's Macs)
produces contested labels, file one finding per label, `proposed` until a
person accepts, per The Way.

## Real-corpus note

Human-message recall sampling on Ryan's real corpus (aggregate numbers only)
happens locally under KDATAP-713a0f; this pass covers the synthetic corpus.
