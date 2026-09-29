# KDATAP-c71b7a: Label email mentions in saleor batch 3

## Files labeled
- `saleor/plugins/user_email/constants.py`
- `saleor/plugins/user_email/default_email_templates/request_email_change.html`

## Record count
- Total records: 18
- Positive: 0
- Negative: 18
- Ambiguous: 0

## Notes
All 18 candidate lines were labeled as negative because they refer to email as a feature/setting/template, not as an email address value:

- **constants.py lines**: All constant definitions and references naming or referencing email templates, template fields, subject fields, and email subject messages. These are configuration and naming conventions, not address data.
- **HTML template lines**: All occurrences are prose text in the email template describing the email change request process or general email instructions, not email address values.

No positive mentions were found in these files, as the saleor user email plugin at this commit focuses on template and configuration constants rather than address handling logic.

## Rationale for all negatives
Applied labeling rules in order:
- Rule 3 (Prose): Lines 80, 83, 84, 85 in constants.py and lines 93, 94, 142 in HTML are human-readable text/messages
- Rule 4 (Feature/Message): Lines 5, 8, 9, 15, 16, 32, 33, 49, 50, 66, 67 in constants.py refer to email as a feature, template system, or configuration property, not as an email address value

All decisions followed the reference document strictly without requiring ambiguous status.

## Branch

Packet and labels: branch `label/KDATAP-c71b7a` (7ef3a77), `tests/benchmark/repos/saleor/annotations/packets/KDATAP-c71b7a.yaml`.

## Coordinator review

18/18 statuses correct. Syntax kinds corrected in round 2. Validator OK on the updated labeling base.
