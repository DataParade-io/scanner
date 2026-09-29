# Labeling Pass: KDATAP-3a9fb5

## Files
- saleor/account/models.py
- saleor/account/notifications.py
- saleor/account/events.py
- saleor/account/search.py
- saleor/account/utils.py

## Record Count
- Total: 60
- Positive: 38
- Negative: 21
- Ambiguous: 1

## Summary
All 60 candidate lines have been labeled following the mention-attribute-labeling reference. The labeling process identified:

- 38 positive mentions where email addresses are held, read, written, passed, validated, stored, or selected
- 21 negative mentions where "email" refers to features, settings, events, operations, or prose rather than addresses
- 1 ambiguous mention on line 416 of models.py (class definition line) where no email mention appears in the specified line text

## Uncertain Items
- **saleor/account/models.py:416**: The candidate text for this line is `'class StaffNotificationRecipient(models.Model):'`, which does not contain an "email" mention. The surrounding context includes email fields (e.g., staff_email on line 424), but the specified line itself has no email token. Marked as ambiguous per rule 6.

## Validator Output
```
tests/benchmark/repos/saleor/annotations/packets/KDATAP-3a9fb5.yaml: 60 records, 60 candidates
  OK
```
