# Labeling Pass: KDATAP-832b8c

Labeled email address mentions in `saleor/plugins/sendgrid/plugin.py` (Saleor batch 7).

## Files
- `saleor/plugins/sendgrid/plugin.py`

## Record count
- Total: 66 annotations
- Positive: 3
- Negative: 63
- Ambiguous: 0

## Positive lines
1. **L113**: `{"name": "sender_address", "value": ""}` - Configuration dictionary entry storing the sender email address key name (string_literal).
2. **L137**: `"sender_address": {` - Configuration structure field definition for sender email address (property_key).
3. **L139**: `"help_text": "Sender email which will be visible as 'from' email."` - Help text explicitly describing the sender_address as the email for the "from" field (string_literal).

## Uncertain or complex decisions
None. All candidate lines had clear application of the reference guide rules:
- Function names that refer to sending email (send_*_email_task) are NEGATIVE (rule 4: The word means a message or a feature, not an address).
- Event enumeration keys (ACCOUNT_CHANGE_EMAIL_CONFIRM) are NEGATIVE (rule 4).
- Configuration template IDs and labels are NEGATIVE (rule 4: email settings and flags).
- The sender_address configuration field and its help text are POSITIVE (rule 5: field definition and help text that describes holding an email address).
- Comments and log message prose are NEGATIVE (rule 3: Prose).

## Validator output
```
tests/benchmark/repos/saleor/annotations/packets/KDATAP-832b8c.yaml: 66 records, 66 candidates
  OK
```

Labeled by Claude Haiku 4.5 on 2026-09-28.
