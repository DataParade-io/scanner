# Decomposition

Negative finding: scanner must not emit these components on this fixture.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| components | `asset:aiosqlite` | `app.py:1-1` | negative | (none) | no |
| components | `asset:asyncpg` | `app.py:1-1` | negative | (none) | no |
| components | `asset:pymysql` | `app.py:1-1` | negative | (none) | no |

Eval cases are not added yet because the bug is unfixed and negativeCasePassRate would drop. Precision already counts these as false positives via the exhaustive scope.
