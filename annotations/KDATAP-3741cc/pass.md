# Labeling Pass: KDATAP-3741cc

## Files Labeled

- api/src/database/migrations/20240422A-public-registration.ts (4 lines)
- api/src/database/migrations/20210903A-add-auth-provider.ts (4 lines)
- api/src/controllers/users.ts (4 lines)
- api/src/controllers/auth.ts (4 lines)
- api/src/license/entitlements/lib/sso-enabled.ts (3 lines)
- api/src/auth/drivers/saml.ts (3 lines)
- api/src/auth/drivers/local.ts (3 lines)
- api/src/mailer.ts (22 lines)

## Record Count

Total records: 47

## Label Distribution

- Positive (email address usage): 17 records
- Negative (configuration/feature names, prose, not addresses): 30 records
- Ambiguous: 0 records

## Summary by Category

### Positive Email Mentions (17)
These lines read, write, validate, or pass email address values:
- Local auth driver: checking and selecting by email address, validating email schema
- SAML driver: reading email from SAML payload, creating user with email
- Auth controller: validating email in password reset request, passing email to service
- Users controller: validating email for invitations and registration
- Database migrations: schema operations on email column (dropUnique, changeToType, unique)
- SSO license entitlements: type annotation and assignment of admin email

### Negative Email Mentions (30)
These lines mention email but do not operate on address values:
- Configuration variable names (EMAIL_TRANSPORT, EMAIL_SMTP_USER, etc.) - 16 occurrences
- Module and class names (SendEmailCommand, EmailRecipient) - 2 occurrences
- Error and log messages (prose strings) - 3 occurrences
- Feature flags and settings (email verification flags, email filter columns) - 4 occurrences
- Email feature names in routes and functions - 5 occurrences

## Validation Result

```
tests/benchmark/repos/directus/annotations/packets/KDATAP-3741cc.yaml: 47 records, 47 candidates
  OK
```

## Notes on Labeling

- All 47 candidate lines from the specified files were labeled exactly once.
- Declarations were added for all positive identifier and property_key occurrences.
- Owner field set to "api" (the nearest package.json is at the api/ directory level).
- Proposed model: claude-haiku-4-5-20251001
- Proposed date: 2026-09-30
