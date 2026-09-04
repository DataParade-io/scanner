# Decomposition

Eval cases: `raw-jvm-yaml-password`, `mention-jvm-yaml-password`, `data-item-jvm-password`.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| raw-hits | `raw_hit:password` | `src/main/resources/application.yml:7-7` | positive | user_password | no |
| mentions | `mention:password` | `src/main/resources/application.yml:7-7` | positive | user_password | no |
| data-items | `data_item:password` | `src/main/resources/application.yml:7-7` | positive | user_password | no |

Graph layers do not apply.
