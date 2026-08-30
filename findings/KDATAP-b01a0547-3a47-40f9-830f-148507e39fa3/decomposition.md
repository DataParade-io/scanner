# Decomposition

Eval cases: `raw-java-email-parameter`, `mention-java-email-parameter`, `data-item-java-email`.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| raw-hits | `raw_hit:email` | `src/main/java/com/acme/billing/data/CustomerRepository.java:9-9` | positive | user_email | no |
| mentions | `mention:email` | `src/main/java/com/acme/billing/data/CustomerRepository.java:9-9` | positive | user_email | no |
| data-items | `data_item:email` | `src/main/java/com/acme/billing/data/CustomerRepository.java:9-9` | positive | user_email | no |

Graph layers do not apply (this finding is the email parameter only).
