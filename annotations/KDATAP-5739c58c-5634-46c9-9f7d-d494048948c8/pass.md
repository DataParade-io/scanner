# Annotation pass: email declaration grouping (ghost)

## Repository / fixture

ghost, pinned commit per manifest. Input: tests/benchmark/repos/ghost/annotations/packets/email-grouping-input.yaml (positive email mentions clustered by shared declaration).

## Scope

All positive email mentions from the 27 labeling batch packets plus the worked example.

## Result

27 groups covering 230 mentions; 20 clusters (42 mentions) in needs_adjudication, mostly shared helpers whose subject depends on the caller (sender-field validation, address parser, getMemberData). Member and staff user emails are separate groups (separate tables); stored copies (Stripe customer, email recipient, automation run, email change, spam complaint, suppression) are separate groups. One relabel from review: schema.js:404 settings group name is negative.

Output: tests/benchmark/repos/ghost/annotations/packets/email-groups.yaml on branch kdatap-grouping-email. Group ids are written into mention_attributes.group on every batch packet branch; mentions in needs_adjudication carry no group and are excluded from the grouping metric.

## Method

Sonnet read the source for each cluster and linked clusters only on code evidence (same model column or field, value flow, same payload or settings field), following tests/benchmark/email-grouping-instructions.md. Coordinator verified coverage (every cluster exactly once) and reviewed the groups.

## Human review

This annotation stays in awaiting-review until a person accepts it.
