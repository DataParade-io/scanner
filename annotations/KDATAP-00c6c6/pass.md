# KDATAP-00c6c6 Labeling Pass Notes

## Files Labeled
- `packages/core/email/shared/email-address-parser.ts`

## Record Count
- Total: 64 records
- Positive: 21
- Negative: 43
- Ambiguous: 0

## Labeling Notes

This file is an RFC-compliant email address parser with multiple utility functions for parsing, formatting, and validating email addresses.

### Positive Mentions (21)
The positive mentions identified are primarily:
- Parameter `emailString` in the main `parseEmailAddress` function (lines 217, 218, 222, 225) - receives the email address string to parse
- Local variable `email` in the angle bracket parsing section (lines 237, 253) - stores the parsed email address from the matched pattern
- Property keys `email` in return objects (lines 219, 266, 274) - fields holding the parsed email address values
- Function parameter `email` in formatting function (line 294) - receives email address to format
- Uses of `email` parameter in formatting (lines 296, 306, 309) - returns and embeds the email in formatted output
- Function parameter `email` in validation function (lines 319, 320, 329) - receives and validates the email address
- Return type `ParsedEmailAddress` annotation (line 345) - declares return of parsed email addresses
- Parameter `emailsString` in multi-email parsing (lines 346, 356) - iterates through comma-separated addresses
- Function call `parseEmailAddress` in map operation (line 392) - calls the parser to process each address

### Negative Mentions (43)
The negative mentions are primarily:
- Comments and docstrings (38 total) - describing the module, functions, formats, examples, and parameters
- Function names `parseEmailAddress` and `parseMultipleEmailAddresses` (lines 217, 343) - naming functions after the concept, not holding address values
- Parameter `emailsString` in multi-email function (line 344) - holds a batch of addresses, not a single address value
- Regex pattern variable `emailPattern` (line 326) - holds a validation rule, not an address value

## Validator Result
The packet was validated and produced: **OK**

No corrections needed. All 64 candidate lines were labeled with exactly one record per line.
