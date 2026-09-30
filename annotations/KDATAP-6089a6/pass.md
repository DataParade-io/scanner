# Labeling Pass for KDATAP-6089a6

## Files Labeled
- packages/core/admin/ee/server/src/controllers/user.ts
- packages/core/admin/server/src/utils/normalize-email.ts
- packages/core/admin/server/src/controllers/authenticated-user.ts
- packages/core/admin/shared/contracts/authentication.ts
- packages/core/admin/ee/server/src/controllers/authentication-utils/middlewares.ts
- packages/core/strapi/src/cli/commands/admin/list-users.ts
- packages/core/admin/server/src/validation/user.ts
- packages/core/admin/server/src/services/passport/local-strategy.ts
- packages/core/admin/server/src/middlewares/rateLimit.ts
- packages/core/admin/ee/server/src/audit-logs/services/audit-logs.ts
- packages/core/admin/server/src/content-types/User.ts

## Record Count
- Total records: 56
- Positive (actual email addresses): 28
- Negative (features, functions, messages, types): 28
- Ambiguous: 0

## Labeling Notes

Applied the mention-attribute labeling rules from the reference guide:

1. **Negative Labels (28)**:
   - Comments and docstrings about email functionality
   - Import statements for email utilities
   - Function/method names containing "email" that reference email features (sendEmail, normalizeEmail, findOneByEmail, etc.)
   - Error/log messages with email prose
   - Email configuration keys and template references
   - Type specifications and field type definitions
   - Email feature flags and settings (email_disabled, email_count, etc.)
   - Email relation and table names

2. **Positive Labels (28)**:
   - Direct reads of email address values from objects (user.email, profile.email, etc.)
   - Assignment of email values to variables
   - Email address passed as function parameters
   - Email values in object literals and destructuring
   - Email address field selections in queries
   - Email address validation rules
   - Email address return types and picks
   - Email address used in template data

## Validator Output
`OK` - All 56 records passed validation.

## Uncertainties
None. All candidate lines had clear classification based on the labeling rules. The distinction between feature/function names (negative) and actual address value handling (positive) was consistently applied.
