# Proposal

## Fixture or repository

`tests/fixtures/python-basic`

## What we expect to find

`app.py` line 7 calls `psycopg2.connect("postgres://example")`. That is a real Postgres connection and should surface a `psycopg2` database asset plus a `database_query` flow from the app asset.

Verified against `scan()`: those keys are **absent**. The scanner instead emits `asset:aiosqlite`, `asset:asyncpg`, and `asset:pymysql` from `app.py:1-1` (file-level driver heuristics). The gold stays a documented gap: expected detection, measured miss.

## Human review

Reviewed against fixture source and live scan output. Gap confirmed. Advanced off proposed after that check.
