# Proposal

## Fixture or repository

`tests/fixtures/typescript-basic`

## What we expect to find

`db-client-import.ts` line 1 imports `./pg-client`. The TypeScript analyzer treats a module import containing `pg` as a database asset. The scan should emit `asset:pg` labeled `database` and a `database_query` flow from the root API asset to that database, both on the import line.

Verified against `scan()`: `asset:pg` at `db-client-import.ts:1-1` and `flow:asset:root api->asset:pg` (`database_query`) at the same span. The actual `pool.query` lives in `pg-client.ts`; gold follows the scanner’s import heuristic, not the query call site.

## Human review

Reviewed against fixture source and live scan output. Advanced off proposed after that check.
