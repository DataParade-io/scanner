# Proposal

## Fixture or repository

`tests/fixtures/typescript-basic`

## What we expect to find

`server.ts` line 23 uses `passport.authenticate("jwt", { session: false })`. That is local JWT middleware, not an outbound vendor and not a passport-number identifier.

Verified against `scan()` and the PII matcher: no `third_party:passport`, no flow to passport, and no `raw_hit:passport` / `mention:passport` / `data_item:passport`. The current `passport` heuristic only matches `passport_number`, `passport_no`, and similar tokens — not the bare word `passport` — so this negative does not exercise a near-miss false-positive path. The gold is still correct: this line must stay clean.

## Human review

Reviewed against fixture source, PII rules, and live scan output. Advanced off proposed after that check.
