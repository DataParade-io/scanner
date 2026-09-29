# KDATAP-cca74f: Label email mentions - ghost batch 9

## Labeling Results

**File**: `ghost/core/core/server/services/newsletters/newsletters-service.js`

**Total Records**: 70

**Status Breakdown**:
- Positive: 28
- Negative: 41
- Ambiguous: 1

## Positive Records (28 total)
- L65: `email` parameter in getText function receives email address
- L77: email address interpolated into verification message text
- L81: `email` parameter in getHTML function receives email address
- L82: passes email parameter to verifyEmailTemplate
- L301: reads sender_reply_to email address from cleanedAttrs
- L302: checks if sender_reply_to email address is in allowed list
- L313: local variable assigned from cleanedAttrs[property] containing email address
- L314: reads email address to check if it changed
- L316: checks if email address is defined
- L317: checks if email address is null or empty
- L321: passes email address to validation service
- L325: passes email address to template placeholder in error message
- L330: compares email address to sender_email
- L335: pushes email address to collection for storage
- L344: reads sender_reply_to email address from attrs parameter
- L345: reads sender_reply_to email address from newsletter
- L348: reads sender_email address from attrs parameter
- L349: reads sender_email address field for comparison
- L350: reads sender_email address from newsletter
- L352: reads sender_email address for validation
- L359: writes email address field (set to null) on cleanedAttrs
- L371: destructures email address from collection items
- L372: passes email address to sendEmailVerificationMagicLink
- L385: email parameter receives email address
- L386: reads email address from emailAddressService
- L396: passes sender email address to message object
- L408: passes email address to sendMagicLink call
- L409: object key holds email address value in tokenData

## Ambiguous Records (1 total)
- L351: Multi-line call to validate(); email address argument on line 352, this line shows only method call start

## Notes
The newsletter-service.js file contains 70 email-related candidate lines. Most negatives are:
- Function/method names about email handling (not the addresses themselves)
- Email record collections (emailsToVerify), not individual addresses
- Object property names and keys naming email properties
- Comments and docstrings about email functionality
- String literals for email subjects, error messages, URLs (not containing address values)
- Boolean flags (email_verified, email_disabled)
- References to the emailAddressService object (the service, not addresses)

The one ambiguous case (L351) is a multi-line method call where the address being validated spans to the next line.

## Validation
Validator output: OK (70 records, 70 candidates matched)

## Branch

`label/KDATAP-cca74f` (20a5ae2).

## Coordinator review

70 records: 28 positive, 42 negative. Statuses accepted; coordinator resolved the one ambiguous line (351, a call opener naming the service) as negative. Validator OK.
