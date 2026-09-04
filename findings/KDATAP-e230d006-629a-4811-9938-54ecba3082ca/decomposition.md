# Decomposition

Eval cases: `raw-jvm-yaml-username`, `mention-jvm-yaml-username`, `data-item-jvm-username`, `data-item-jvm-username-multi-file`, `data-item-jvm-username-identity-only`.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| raw-hits | `raw_hit:username` | `src/main/resources/application.yml:6-6` | positive | username | no |
| mentions | `mention:username` | `src/main/resources/application.yml:6-6` | positive | username | no |
| data-items | `data_item:username` | `src/main/resources/application.yml:6-6` (also `bootstrap.yml:6-6`) | positive | username | no |

Graph layers do not apply. The bootstrap.yml username hit is the multi-file roll-up evidence, not a second finding.
