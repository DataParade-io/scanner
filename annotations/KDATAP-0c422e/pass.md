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
