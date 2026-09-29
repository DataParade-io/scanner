# Annotation pass: email declaration grouping (saleor)

## Repository / fixture

saleor, pinned commit per manifest. Input: tests/benchmark/repos/saleor/annotations/packets/email-grouping-input.yaml (positive email mentions clustered by shared declaration).

## Scope

All positive email mentions from the 27 labeling batch packets plus the worked example.

## Result

14 groups covering 181 mentions; 24 clusters (36 mentions) in needs_adjudication, mostly where the producing code is outside the corpus scope (GraphQL mutations, invoice and CSV payload builders). Staff and customer accounts share the User model, so they are one group (user-account-email). Order.user_email, checkout email, voucher usage email, and the gift card created_by/used_by/assigned_to/notification emails are separate groups.

Output: tests/benchmark/repos/saleor/annotations/packets/email-groups.yaml on branch kdatap-grouping-email. Group ids are written into mention_attributes.group on every batch packet branch; mentions in needs_adjudication carry no group and are excluded from the grouping metric.

## Method

Sonnet read the source for each cluster and linked clusters only on code evidence (same model column or field, value flow, same payload or settings field), following tests/benchmark/email-grouping-instructions.md. Coordinator verified coverage (every cluster exactly once) and reviewed the groups.

## Human review

This annotation stays in awaiting-review until a person accepts it.
