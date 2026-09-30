# KDATAP-e5e3e0 Labeling Pass Notes

## Files Labeled
- packages/core/email/server/src/bootstrap.ts
- packages/core/email/server/src/controllers/email.ts
- packages/core/email/server/src/services/email.ts
- packages/core/email/server/src/types.ts

## Record Count
Total: 65 annotations

### Status Breakdown
- Positive: 3
- Negative: 62
- Ambiguous: 0

### Positive Mentions (3)

1. **controllers/email.ts:L42** - `email: SendOptions`
   - Variable declaration holding address options object
   - Kind: identifier, declaration: local

2. **controllers/email.ts:L44** - Template string with recipient address
   - String includes `${to}` (recipient address placeholder)
   - Kind: string_literal

3. **types.ts:L20** - `email: string;`
   - Field definition in EmailTemplateData interface holding email address
   - Kind: property_key, declaration: field

### Negative Mentions (62)

Most candidates were negative because they:
- Are type imports or type definitions (EmailConfig, SendOptions, EmailOptions, EmailTemplate, EmailTemplateData, EmailProvider, EmailProviderModule)
- Are configuration/provider objects and methods (getProviderSettings, provider.send, service calls)
- Refer to email as a feature or message type (send, plugin, provider, settings)
- Are error messages or prose containing the word "email" but not holding address values
- Are comments or JSDoc documentation

### Key Patterns Observed

1. **Type Definitions**: Interface/type names and type references all negative as they define the shape of email data structures rather than holding address values

2. **Service/Provider References**: Calls to email service methods, provider initialization, and configuration retrieval all negative

3. **Feature vs. Address**: Correctly distinguished between email as a feature/concept (negative) vs. email as an address value (positive)

4. **Template Strings**: Most template strings in messages and configurations were negative; only the one with the actual recipient address placeholder was positive

## Validation
- Validator output: OK
- No duplicate IDs
- All 65 candidates matched exactly
- One record per candidate line as required

## Notes on Uncertain Cases
- No ambiguous cases were needed; all lines could be clearly classified
- The distinction between email as a configuration/feature concept versus email addresses holding user values was consistently clear from context
