# KDATAP-59f187 Labeling Pass Notes

## Files Labeled
- `api/src/services/users.ts`

## Record Count
- Total records: 84
- Positive: 57
- Negative: 27
- Ambiguous: 0

## Labeling Notes

All 84 email mention candidates from `api/src/services/users.ts` have been labeled according to the mention-attribute-labeling rules.

### Labeling Summary

**Positive mentions (57):** Email address values being read, written, passed, validated, stored, or selected. Includes:
- Method parameters holding email addresses (e.g., `getUserByEmail(email)`, `inviteUser(email)`)
- User email field reads and writes (e.g., `user.email`, `data['email']`)
- Database queries and selections on email columns
- Email values in JWT payloads and template data
- Email validation operations

**Negative mentions (27):** Feature/message words, comments, functions that deal with email operations but don't hold address values. Includes:
- Comments about email handling (comments have no runtime effect)
- Function names like `validateEmail`, `checkUniqueEmails`, `inviteUser` (function names are negative)
- Email list/array operations (`emails` plural, `email_count`, `email_recipients`)
- Configuration and feature flags (`public_registration_verify_email`, `hasEmailVerification`)
- Log/error messages with prose text about email operations
- Email settings keys and environment variable references

**Ambiguous mentions (0):** None - all candidates could be clearly classified using the rules.

## Validation
The packet file passes validation with the benchmark:validate-packet command.
