# Decomposition

Negative finding: scanner must not emit a locationless `actor:user` when no user-actor evidence exists.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| components | `actor:user` | (locationless) | negative | (none) | no |

Eval cases are not added yet because the bug is unfixed. Precision already counts locationless findings in the denominator.
