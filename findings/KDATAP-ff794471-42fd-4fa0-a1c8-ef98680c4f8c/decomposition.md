# Decomposition

Eval cases: `ts-passport-not-third-party`, `ts-passport-no-external-flow`, `raw-ts-passport-auth-not-number`, `mention-ts-passport-auth-not-number`, `data-item-ts-no-passport`, `raw-ts-passport-strategy-not-number`, `mention-ts-passport-strategy-not-number`, `data-item-ts-no-passport-strategy`.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| components | `third_party:passport` | `server.ts:23-23` | negative | (none) | no |
| data-flows | `flow:asset:root api->third_party:passport` | `server.ts:23-23` | negative | (none) | no |
| raw-hits | `raw_hit:passport` | `server.ts:23-23` | negative | (none) | no |
| mentions | `mention:passport` | `server.ts:23-23` | negative | (none) | no |
| data-items | `data_item:passport` | `server.ts:23-23` | negative | (none) | no |
| raw-hits | `raw_hit:passport` | `server.ts:31-31` (`passport_strategy`) | negative | (none) | no |
| mentions | `mention:passport` | `server.ts:31-31` | negative | (none) | no |
| data-items | `data_item:passport` | `server.ts:31-31` | negative | (none) | no |
