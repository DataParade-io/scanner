# KDATAP-fc825a: Label email mentions - strapi batch 2

## Task Completion

**Status:** COMPLETE - All 61 candidate lines labeled and validated.

## Files Labeled

- `packages/core/admin/server/src/services/user.ts`
- `packages/core/admin/server/src/services/auth.ts`
- `packages/core/strapi/src/cli/commands/admin/reset-user-password.ts`
- `packages/core/admin/server/src/controllers/user.ts`
- `packages/core/admin/ee/server/src/services/auth.ts`

## Record Count

- **Total records:** 61
- **Positive:** 38
- **Negative:** 23
- **Ambiguous:** 0

## Labeling Notes

### Labeling Decisions

**Positive (38 records):** Lines that read, write, pass, validate, or select email address values, or declare parameters/fields that hold addresses. Includes:
- Function parameters receiving email addresses for user lookups
- Database query field selections for email
- Email addresses passed to mail sending functions
- Interface/class field declarations for email
- Prompt field definitions and option flags for email input
- Function calls to operations working with email addresses

**Negative (23 records):** Lines where "email" refers to the email feature/concept rather than address values. Includes:
- JSDoc comments and docstrings describing email functionality
- Email plugin service method names and calls
- Email template configuration keys
- Error messages and prose about email functionality
- Email configuration settings (non-address)

### Noteworthy Patterns

1. **"email" in function/variable names:** Lines containing "email" as part of longer names (e.g., `uniqueEmailCheck`, `normalizeEmail`, `findOneByEmail`, `resetPasswordByEmail`) are marked positive because these functions/variables work with or return email addresses.

2. **Comments and Docstrings:** All JSDoc comments and docstrings were marked negative per rule 1 of the labeling guide.

3. **Plugin and Configuration References:** Calls to the email plugin service and email configuration keys were marked negative as they refer to the email feature itself, not address values.

4. **Template Data Inclusion:** Lines where email fields are selected for inclusion in email template data were marked positive because the email address value is being passed.

## Validation Results

Validation command: `pnpm run benchmark:validate-packet tests/benchmark/repos/strapi/annotations/packets/KDATAP-fc825a.yaml`

Result: **OK** - All 61 candidate lines have exactly one matching record each. No validation errors.

## No Ambiguous Cases

All 61 candidates were definitively categorized as positive or negative based on the labeling reference rules. No cases required ambiguous classification.
