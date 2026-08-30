# Proposal

## Fixture or repository

`tests/fixtures/python-basic`

## What we expect to find

The scanner must NOT emit `asset:aiosqlite`, `asset:asyncpg`, or `asset:pymysql` on `app.py`. The fixture imports only `psycopg2`, `requests`, and `FastAPI`. Those three phantom drivers share `connect` as a callName; `psycopg2.connect` on line 7 triggers all of them.

Verified against `scan()`: `asset:aiosqlite`, `asset:asyncpg`, and `asset:pymysql` appear at `app.py:1-1`. These are false positives. Tracked by bug KDATAP-0f7953.

## Human review

Reviewed against fixture source and live scan output. The expectation (negative) is correct. Advanced off proposed after that check.
