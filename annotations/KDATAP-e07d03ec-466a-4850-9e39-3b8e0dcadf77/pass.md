# KDATAP-e07d03: Label email mentions - ghost batch 2

## Files labeled

- `ghost/core/core/server/services/members/api.js` (35 candidate lines)
- `ghost/core/core/server/services/members/import-export/import/completion-email.ts` (23 candidate lines)

## Record count

- Total records: 58
- Positive: 19
- Negative: 39
- Ambiguous: 0

## Positive lines

All address-holding or address-passing mentions:

1. api.js L81: `from` property key setting sender email from config
2. api.js L111: `email` parameter holding recipient email
3. api.js L128: Email address interpolated into "Sent to {email}" message
4. api.js L145: Email address interpolated into signup "Sent to {email}" message
5. api.js L162: Email address interpolated into paid signup "Sent to {email}" message
6. api.js L177: Email address interpolated into updateEmail "Sent to {email}" message
7. api.js L199: Email address interpolated into signin "Sent to {email}" message
8. api.js L204: `email` parameter for HTML generation
9. api.js L214: `email` property key passed to subscribe email template
10. api.js L216: `email` property key passed to signup email template
11. api.js L218: `email` property key passed to paid signup email template
12. api.js L220: `email` property key passed to updateEmail template
13. api.js L223: `email` property key passed to signin email template
14. completion-email.ts L23: `recipient` field holding recipient email address
15. completion-email.ts L72: `email` field selecting email address from MemberImportRow
16. completion-email.ts L102: `email` object key mapping email address
17. completion-email.ts L138: `recipient` parameter holding recipient email address
18. completion-email.ts L149: `to` property key setting recipient email for email message
19. completion-email.ts L157: `emailRecipient` property key passing recipient email to renderer

## Key notes

- All imports of email-related modules are correctly labeled negative (lines 8-12, 21, 23 in api.js; line 2 in completion-email.ts)
- All email feature/type names (EmailRecipient, MemberEmailChangeEvent, EmailSpamComplaintEvent, etc.) are correctly negative
- All prose error messages and comments mentioning email are correctly negative
- Email addresses passed or interpolated into messages are correctly positive (rule 3 exception: log/message text with address values)
- Function parameters and property keys that hold email addresses are correctly positive
- Field definitions and type annotations related to email addresses are correctly identified
- No ambiguous cases encountered; all lines had clear status determination based on reference rules

## Validator output

```
tests/benchmark/repos/ghost/annotations/packets/KDATAP-e07d03.yaml: 58 records, 58 candidates
  OK
```

## Branch

`label/KDATAP-e07d03` (a3dd644).

## Coordinator review

58 records: 19 positive, 39 negative. Statuses accepted; coordinator added written type annotations on two TypeScript fields. Validator OK.
