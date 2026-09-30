# KDATAP-faabdc: Label email mentions in strapi batch 1

## Files

- packages/core/strapi/src/cli/commands/admin/delete-user.ts
- packages/core/strapi/src/cli/commands/admin/create-user.ts
- packages/core/strapi/src/cli/commands/admin/block-user.ts
- packages/core/strapi/src/cli/commands/admin/active-user.ts

## Record count

Total records: 65

### Status distribution

- Positive: 55
- Negative: 10
- Ambiguous: 0

## Notes

All 65 candidate lines were successfully labeled. The labeling followed the mention-attribute-labeling rules:

- Positive labels include: email address parameters, validators, schema fields, prompts, function calls that use email, and template strings that embed email values.
- Negative labels include: prose messages (error text, CLI help text), comment strings, and option labels that reference email conceptually but don't hold address values.

The `emailValidator` function and `validEmail` variables that result from validation were classified as positive since they hold the result of email address validation. The `cleanEmail` variables that normalize email addresses to lowercase were also classified as positive.

All records passed validator: OK
