# Pass Notes: KDATAP-bb7de7

## Email Mentions Labeling - Directus Batch 2

### Files Labeled (9 total)
- api/src/services/mcp-oauth/index.ts
- api/src/auth/drivers/openid.ts
- api/src/auth/drivers/oauth2.ts
- api/src/services/tfa.ts
- api/src/services/authentication.ts
- api/src/cli/commands/users/passwd.ts
- api/src/cli/commands/users/create.ts
- api/src/auth/drivers/ldap.ts
- api/src/utils/create-admin.ts

### Record Count
Total records: 59

### Status Breakdown
- **Positive**: 41 (lines holding, reading, writing, passing, or validating email addresses)
- **Negative**: 18 (comments, error messages, OAuth scopes, configuration names, feature flags, not address values)
- **Ambiguous**: 0

### Analysis Notes

#### Positive Labels (41 records)
Email addresses are present when:
- Declaring fields/parameters/types that hold addresses (e.g., `email?: string`, `email: Joi.string().email()`)
- Reading addresses from objects or databases (e.g., `getEntryValue(entry[mailAttribute])`, `.select('email')`)
- Writing/assigning addresses (e.g., `user.email = email`)
- Passing addresses to functions (e.g., `email: userInfo.email`, `await service.requestPasswordReset(email, ...)`)
- Using addresses as query conditions (e.g., `.whereRaw('LOWER(??) = ?', ['email', ...])`)
- In template variable usages within code

#### Negative Labels (18 records)
Not email addresses when:
- Appearing in JSDoc/code comments explaining functionality
- String literals used as OAuth/OIDC scope declarations (requesting email profile data, not the address)
- Configuration parameter names (`emailKey`, `identifierKey`)
- Boolean flags or feature switches (`email_verified`, `isEmailVerified`, `email_disabled`)
- Error message and log message prose
- Endpoint/path names for email-related features

#### Key Labeling Patterns Observed
1. **OAuth/OIDC Drivers** (oauth2, openid, ldap): Generally positive for actual address values, negative for scope strings and feature flags
2. **CLI Commands** (users/create, users/passwd): Positive for parameters and validation, negative for UI labels
3. **Service/Utility Functions**: Positive for database queries and field selections, negative for comments
4. **Type Annotations and Field Definitions**: Positive when defining address containers

### Validator Output
```
59 records, 59 candidates
OK
```

All annotations pass validation with one record per candidate line as required.
