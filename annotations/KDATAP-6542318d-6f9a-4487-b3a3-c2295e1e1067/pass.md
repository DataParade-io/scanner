# Annotation Pass: KDATAP-654231

## Files
- `ghost/core/core/server/services/email-service/mailgun-email-provider.js`
- `ghost/core/core/server/models/email-recipient.js`

## Record Count
Total: 52

## Status Breakdown
- Positive: 1
- Negative: 51
- Ambiguous: 0

## Positive Lines
1. `ghost/core/core/server/services/email-service/mailgun-email-provider.js:129` - Reads the recipient's email address to use as a key.

## Notes
All candidates labeled according to the email address mention attribute labeling rules. The vast majority are negative because they refer to:
- Model/table names (Email, EmailRecipient, email_recipients, emails)
- Method and function names (email(), emailBatch(), createRecipientData(), etc.)
- Type names and JSDoc comments
- Property keys in relation definitions
- String literals for table/column names and identifiers
- Log/debug messages
- Foreign keys and IDs (not addresses)

The single positive line (L129) reads the `recipient.email` property where `recipient` is a parameter of the reduce callback function.

Validator output: OK

## Branch

`label/KDATAP-654231` (bd58cd2).

## Coordinator review

52 records: 1 positive (recipient.email key in the Mailgun provider), 51 negative (recipient model, relations, recipient objects, comments). Accepted as labeled. Validator OK.
