# Email Mention Labeling - Ghost Batch 5

## Issue
KDATAP-5a074c

## Files Labeled
- `ghost/core/core/server/services/staff/staff-service.js`
- `ghost/core/core/server/models/user.js`
- `ghost/core/core/server/services/auth/setup.js`
- `ghost/core/core/server/services/auth/passwordreset.js`

## Record Count
54 total records

## Label Distribution
- **Positive**: 20 records
- **Negative**: 34 records
- **Ambiguous**: 0 records

## Positive Lines
All positive lines are labeled as either:
- `property_key` (when used as object keys holding email addresses)
- `identifier` (when reading, passing, or returning email address values)

### Key Patterns
1. **Property keys holding addresses**: `email: member.email`, `to: email`, `recipientEmail: data.email`
2. **Identifiers passing addresses**: `getByEmail(email)`, `getByEmail(data.email)`, `getByEmail(tokenParts.email)`
3. **Identifiers reading/returning addresses**: Member searches, user comparisons, function return values

## Key Findings
1. Comments, imports, and error message prose are consistently negative (as expected)
2. Method/function names ending with "email" (like `sendWelcomeEmail`, `getByEmail`) are negative at definition per rule 4
3. Parameters at function/method definition are negative per rule 4
4. Configuration flags and feature toggles (like `sendWelcomeEmail`) are negative
5. Email template container variables (like `emailData`) are negative
6. All address values passed to functions or stored in fields are positive

## Validator Result
✓ OK - 54 records, 54 candidates matched

## Branch

`label/KDATAP-5a074c` (1ac9f07).

## Coordinator review

54 records. Coordinator made 3 function declaration lines positive for their email parameter (getByEmail, sendWelcomeEmail, generateToken). Validator OK.
