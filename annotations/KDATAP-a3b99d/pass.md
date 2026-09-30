# KDATAP-a3b99d: Label email mentions in strapi batch 6

## Files labeled

- `packages/core/email/server/src/routes/admin.ts`
- `packages/core/email/server/src/routes/content-api.ts`
- `packages/core/email/server/src/middlewares/rateLimit.ts`
- `packages/core/email/server/src/routes/validation/email.ts`
- `packages/core/content-type-builder/server/src/controllers/validation/schema.ts`
- `packages/core/content-manager/server/src/mcp/schemas/data-schema.ts`

## Record count

27 records (27 candidates)

## Label distribution

- **Positive**: 3 (reads/writes/validates/holds email address values)
- **Negative**: 24 (feature/type names, handlers, validators, schema definitions)
- **Ambiguous**: 0

## Positive mentions summary

Three candidate lines represent actual email address data handling:

1. **rateLimit.ts:L21** — Selects the email field from the request body to extract the user's email address.
2. **rateLimit.ts:L22** — Local variable that holds and transforms the extracted email address value.
3. **rateLimit.ts:L27** — Uses the email address variable in a template string to build a rate-limit key prefix.

## Notes on labeling decisions

- **Handler names and permission actions** (admin.ts, content-api.ts) are negative because they refer to features or endpoints, not email address values.
- **Class/type/method names** (EmailRouteValidator, sendEmailInput, emailResponse) are negative because they name validation tools, not address data.
- **Zod validator methods** (.email()) are negative because they create validation schemas rather than handling email address values directly.
- **Enum values and type literals** ('email' in schema type enums) are negative because they name attribute types, not addresses.
- **Plugin configuration keys** ('plugin::email' in config.get) are negative because they reference plugin settings, not addresses.

All negative mentions relate to email as a feature/concept rather than as stored or processed address data.
