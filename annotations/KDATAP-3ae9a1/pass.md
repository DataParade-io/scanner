# KDATAP-3ae9a1 Labeling Pass

## Files Labeled
- `ghost/core/core/server/services/email-address/email-address-parser.ts`

## Record Count
- Total records: 18
- Positive: 6
- Negative: 12
- Ambiguous: 0

## Positive Lines
1. `ghost/core/core/server/services/email-address/email-address-parser.ts:15` - Function parameter holding email address string
2. `ghost/core/core/server/services/email-address/email-address-parser.ts:16` - Validates email parameter
3. `ghost/core/core/server/services/email-address/email-address-parser.ts:20` - Passes email to addressparser function
4. `ghost/core/core/server/services/email-address/email-address-parser.ts:44` - Function parameter holding EmailAddress object
5. `ghost/core/core/server/services/email-address/email-address-parser.ts:46` - Returns the address field
6. `ghost/core/core/server/services/email-address/email-address-parser.ts:70` - Passes address field into template string

## Ambiguous Lines
None

## Labeling Notes
- Line 3: Type definition named EmailAddress is negative (structure declaration, not value handling)
- Lines 4, 6, 11-13, 40-42, 54: All JSDoc/comments are negative per rule 1
- Lines 15, 44: Function parameters holding addresses are positive (parameter outranks function name)
- Lines 16, 20: Reading/passing email parameter values are positive
- Line 46: Reading email.address field is positive
- Lines 45, 49: Reading email.name field is negative (reading non-address field)
- Line 70: Template string interpolation of email.address is positive (passes address value)

## Validator Output
```
tests/benchmark/repos/ghost/annotations/packets/KDATAP-3ae9a1.yaml: 18 records, 18 candidates
  OK
```
