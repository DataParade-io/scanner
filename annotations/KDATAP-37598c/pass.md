# KDATAP-37598c Label Completion

## Files

- api/src/services/mail/index.ts
- api/src/services/mail/rate-limiter.ts
- api/src/operations/mail/rate-limiter.ts
- api/src/services/notifications.ts
- api/src/services/comments.ts
- api/src/services/shares.ts

## Record Count

Total: 59 records

## Label Breakdown

- Positive: 15
- Negative: 44
- Ambiguous: 0

## Notes

All candidates labeled according to mention-attribute-labeling.md rules. Positive annotations cover:

1. Email address field selections in queries (string_literal)
2. Email address variable declarations and usage (identifier)
3. Email sender/recipient address parameters and passes
4. Configuration of email addresses in mail service methods

Negative annotations cover:

1. Rate limiter configuration and flags (not addresses)
2. Email feature/service names and function declarations
3. Event names and error handling
4. Template path and other configuration variables
5. User IDs being passed as recipient/sender (not email addresses)
6. Prose text and comments

All records validated successfully with pnpm run benchmark:validate-packet.
