# Labeling pass for KDATAP-698e22

## Files labeled
- `ghost/core/core/server/services/email-service/sending-service.js`

## Record count
Total records: 64

## Status counts
- Positive: 8
- Negative: 56
- Ambiguous: 0

## Positive lines (email addresses being used)
1. **Line 107** (`emailId` identifier): Uses emailId parameter to create cache key; emailId is a unique email identifier.
2. **Line 132** (`from` property_key): From address field passed to email provider; key for sender email.
3. **Line 134** (`emailRenderer` identifier): Gets reply-to email address from the email renderer.
4. **Line 138** (`recipients` identifier): Recipients array passed to provider; list of email addresses.
5. **Line 164** (`email` property_key): Maps member's email address into recipient object.
6. **Line 174** (`recipient` identifier): Filters recipient objects by email validity; recipients parameter.
7. **Line 176** (`Recipient` identifier): Validates recipient email address using validator.
8. **Line 179** (string_literal): Log message that interpolates the invalid email address.

## Notes
- All JSDoc comments (lines 5, 10, 13-14, 16-18, 26-27, 31, 35, 40, 44, 48-49, 61, 72-74, 101, 103-104, 111, 157-158) are labeled as negative per the rule that "the scanner ignores comments."
- Service provider variables (`emailProvider`, `emailRenderer`, `emailAddressService`) are labeled negative as they refer to service instances, not email addresses.
- Cache operations and flag variables (`emailBody`, `isTestEmail`, `isValidRecipient`) are labeled negative as they don't hold email address values.
- The distinction between positive and negative for functions mentioning "email" relies on whether the line is using/returning/passing an address value versus declaring/defining the function itself.
- Line 134 required special handling: the subject name is `emailRenderer` (the class field), but the line is positive because it's calling a method to get an address. The declaration points to where the field is declared (line 67).

## Validator output
```
tests/benchmark/repos/ghost/annotations/packets/KDATAP-698e22.yaml: 64 records, 64 candidates
  OK
```

## Branch

`label/KDATAP-698e22` (005a247).

## Coordinator review

64 records: 6 positive, 58 negative. Coordinator set emailId (newsletter email record id) and the recipient-object filter line negative, and named 176 by its recipient.email occurrence. Validator OK.
