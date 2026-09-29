# Packet KDATAP-582087 Pass Report

## Files Labeled

- `ghost/core/core/server/services/email-suppression-list/email-suppression-list.js`
- `ghost/core/core/server/models/email.js`

## Record Count

Total records: 54

## Status Breakdown

- Positive: 6 records
- Negative: 48 records
- Ambiguous: 0 records

## Positive Lines

1. `email-suppression-list.js:67` - `removeEmail(email)` - Parameter holds email address
2. `email-suppression-list.js:76` - `getSuppressionData(email)` - Parameter holds email address
3. `email-suppression-list.js:84` - `getBulkSuppressionData(emails)` - Parameter holds array of addresses
4. `email-suppression-list.js:85` - `email` in arrow function - Parameter receives each address from array
5. `email-suppression-list.js:105` - `emailAddress` parameter - Constructor parameter holds email address
6. `email-suppression-list.js:107` - `emailAddress` property key - Object key writing address value

## Notes

All email.js candidates were labeled negative because they relate to:
- Model/class/collection names (Email, Emails, EmailBatch, EmailRecipient)
- Filter properties and logic (recipient_filter)
- Foreign key IDs (email_id)
- Event naming (email + '.' + event)
- Table and relationship names

All email-suppression-list.js negative candidates were:
- JSDoc comments and type annotations
- Class and interface names
- Method/function names that don't hold addresses
- Type references

The six positive cases are all where parameters or properties directly hold email address values that are being processed or stored.

Validator output: OK
