# Label pass: KDATAP-0254c6

Labeled email candidates in Ghost schema.js for commit 73612b18663c0145dcca8611904b7f21b5f84552.

## Files

- `ghost/core/core/server/data/schema/schema.js`

## Results

- **Total records:** 98
- **Positive:** 35 (email address fields and validations)
- **Negative:** 63 (non-address fields, IDs, relations, flags, counts, error messages, etc.)
- **Ambiguous:** 0

## Approach

Applied labeling rules from `references/mention-attribute-labeling.md`:

- **Positive lines:** Email address field definitions (`sender_email`, `to_email`, `from_email`, `member_email`, `recipient_email`, `buyer_email`, `email`), email validation rules (`validations: { isEmail: true }`), and string literal references to email columns.
- **Negative lines:** Display name fields (`sender_name`, `recipient_name`), boolean flags (`email_disabled`, `email_only`), counts (`email_count`, `email_open_rate`), foreign key IDs (`email_id`, `email_recipient_id`), table/relation names (`email_recipients`, `email_batches`), field content descriptors (`email_subject`, `email_lexical`), timestamps, and filters.

## Validation

`pnpm run benchmark:validate-packet` printed **OK**.

## Positive lines (35 total)

- Line 26: sender_email (field definition)
- Line 27: sender_reply_to (field definition)
- Line 274: email (field definition)
- Line 279: email (isEmail validation)
- Line 404: email (string literal in array)
- Line 500: email (field definition)
- Line 505: email (isEmail validation)
- Line 649: email (field definition)
- Line 654: email (isEmail validation)
- Line 914: to_email (field definition)
- Line 919: email (isEmail validation)
- Line 921: from_email (field definition)
- Line 926: email (isEmail validation)
- Line 1220: email (field definition)
- Line 1478: email (field definition)
- Line 1483: email (isEmail validation)
- Line 1646: member_email (field definition)
- Line 1871: email (field definition)
- Line 1876: email (isEmail validation)
- Line 1899: email_address (field definition)
- Line 1904: email (isEmail validation)
- Line 2104: sender_email (field definition)
- Line 2108: email (isEmail validation)
- Line 2110: sender_reply_to (field definition)
- Line 2114: email (isEmail validation)
- Line 2255: member_email (field definition)
- Line 2259: email (isEmail validation)
- Line 2329: sender_email (field definition)
- Line 2333: email (isEmail validation)
- Line 2335: sender_reply_to (field definition)
- Line 2339: email (isEmail validation)
- Line 2453: email (isEmail validation in buyer_email field)
- Line 2532: recipient_email (field definition)
- Line 2536: email (isEmail validation)

## Notes

All candidates were resolved with clear positive or negative classifications. The schema file contains primarily database schema definitions where email address fields are explicitly defined with `{ type: 'string', validations: { isEmail: true } }` patterns, making classification straightforward. No ambiguous cases remained after careful analysis of field types and purposes.
