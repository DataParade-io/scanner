# Corpus gold — next adjudication slice

Continues **KDATAP-182788** (corpus gold from source, not the scanner).

## Current proposed inventory (accepted / rejected / proposed)

| Layer | Accepted | Rejected | Proposed |
| --- | ---: | ---: | ---: |
| Components | 519 | 44 | 0 |
| Data flows | 158 | 17 | 261 |
| Data items | 140 | 119 | 177 |
| Mentions | 79 | 0 | 278 |

## Priority order

1. **Data flows** — 261 proposed rows; use `tests/benchmark/scripts/adjudicate-flow-gold-slice2.ts` to generate packets from pinned source + concept map.
2. **Data items** — 177 proposed; `adjudicate-data-item-gold-slice2.ts`.
3. **Mentions** — 278 proposed YAML rows without per-label findings; requires mentions-specific labeling pass.

## Workflow (no scanner input)

1. Materialize pinned commit for target repo packet.
2. Run adjudication script → review packet in `annotations/<id>/pass.md`.
3. Human accepts packet on Kanbus finding.
4. `--apply` writes YAML + syncs board.
5. Re-run `pnpm run benchmark:readiness` and scorecard; report denominator growth separately from scanner slices.

## Locks

- Do not use `scan()` output as gold input.
- Unresolved rows stay `proposed` until packet accept.
- Corpus changes and scanner changes land in separate commits.
