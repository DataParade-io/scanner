# Decomposition

Eval cases: `raw-tf-address-not-profile`, `mention-tf-address-not-profile`, `data-item-tf-no-address`, `raw-tf-bind-address-not-profile`, `mention-tf-bind-address-not-profile`, `data-item-tf-no-bind-address`.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| raw-hits | `raw_hit:address` | `main.tf:29-29` | negative | (none) | no |
| mentions | `mention:address` | `main.tf:29-29` | negative | (none) | no |
| data-items | `data_item:address` | `main.tf:29-29` | negative | (none) | no |
| raw-hits | `raw_hit:address` | `main.tf:36-36` (`bind_address`) | negative | (none) | no |
| mentions | `mention:address` | `main.tf:36-36` | negative | (none) | no |
| data-items | `data_item:address` | `main.tf:36-36` | negative | (none) | no |

Graph layers do not apply.
