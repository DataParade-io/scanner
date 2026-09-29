# Labeling Pass: KDATAP-0c422e

## Files
- saleor/account/throttling.py
- saleor/account/error_codes.py
- saleor/order/events.py
- saleor/order/notifications.py
- saleor/order/models.py

## Record Count
- Total: 56
- Positive: 33
- Negative: 23
- Ambiguous: 0

## Notes
No ambiguous lines. All candidates were clearly positive (email addresses held, passed, stored, or returned) or negative (function/class names, event type constants, import statements, comments, prose text, or features about email).

Positive lines include:
- Email address parameters in function declarations
- Email addresses in object keys and dictionaries
- Field definitions for email columns
- String literals selecting email fields in queries
- Email addresses read, passed, or returned from variables

Negative lines include:
- Import statements
- Function and class names referring to email features
- Enum constants for email event types
- Index names containing "email"
- Event type parameter values
- Docstring prose text

## Branch

`label/KDATAP-0c422e` (f6e9698).

## Coordinator review

56 records: 33 positive, 23 negative. Coordinator corrected an off-by-one shift in order/events.py (EMAIL_SENT event-type lines 109/124/139/153/168 negative; the "email" parameter keys 111/126/141/155/169 positive) and added the written str type on customer_email parameters. Validator OK.
