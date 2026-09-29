# KDATAP-5fb396: Label email mentions - ghost batch 4

## Files Labeled
- `ghost/core/core/server/services/staff/staff-service-emails.js`

## Record Count
- **Total**: 86 records
- **Positive**: 32
- **Negative**: 54
- **Ambiguous**: 0

## Key Findings

### Labeling Patterns

The file contains staff notification email service logic. The positive mentions are primarily:

1. **Email address reads** (Lines 36, 86, 163, 274, 443): Reading user email addresses from parameters for sending notifications
2. **Property keys** (Lines 63-64, 140-141, 198-199, 232-233, 286, 289, 456-457, 612): Object properties that hold email addresses for template data (fromEmail, toEmail, recipient.email)
3. **Email interpolation** (Line 329): Payer's email interpolated directly in message text
4. **Member email data** (Lines 334, 345-346, 416, 488-492): Email addresses passed and stored in objects

### Negative Classification

Most negative mentions fall into these categories:

1. **Method names** (Lines 33, 83, 160, 271, 323, 377, 412): Methods named after email concept but not returning address values
2. **Method definitions** (Lines 7, 68, 145, 203, 465, 689, 697): Class and method definitions with "email" in names; negative when declared
3. **Comments and strings** (Lines 42, 50, 116, 124, 186, 215-217, 247, 265-266, 622, 655, 676): Comments, JSDoc, and URL/path strings
4. **Module/variable names** (Lines 5, 219, 257, 262, 270, 287, 296, 299, 306, 440, 467, 477): Module imports, function parameters at declaration, config/utility variables

### Ambiguous Lines
None. All 86 lines could be definitively classified based on the reference rules.

## Notes

The file implements a notification system for various Ghost events (free signup, paid subscription, donations, gift subscriptions, milestones). Email addresses are consistently accessed through:
- User model retrieval for sending alerts
- Template data object properties
- Message text interpolation

The rules provided in the reference guide were sufficient to classify all candidates without ambiguity.


## Branch

`label/KDATAP-5fb396` (8f4a5ce).

## Coordinator review

86 records. Coordinator made the fromEmailAddress getter positive, set showEmail negative, and corrected occurrence names and declarations on 596, 612, 431. Validator OK.
