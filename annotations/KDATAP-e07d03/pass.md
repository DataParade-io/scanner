# KDATAP-e07d03: Label email mentions - ghost batch 2

## Files labeled

- `ghost/core/core/server/services/members/api.js` (35 candidate lines)
- `ghost/core/core/server/services/members/import-export/import/completion-email.ts` (23 candidate lines)

## Record count

- Total records: 58
- Positive: 18
- Negative: 40
- Ambiguous: 0

## Positive lines

All address-holding or address-passing mentions:

1. L81 (api.js): `from` property key setting sender email from config
2. L111 (api.js): `email` parameter holding recipient email
3. L128 (api.js): Email address interpolated into "Sent to {email}" message
4. L145 (api.js): Email address interpolated into signup "Sent to {email}" message
5. L162 (api.js): Email address interpolated into paid signup "Sent to {email}" message
6. L177 (api.js): Email address interpolated into updateEmail "Sent to {email}" message
7. L199 (api.js): Email address interpolated into signin "Sent to {email}" message
8. L204 (api.js): `email` parameter for HTML generation
9. L214 (api.js): `email` property key passed to subscribe email template
10. L216 (api.js): `email` property key passed to signup email template
11. L218 (api.js): `email` property key passed to paid signup email template
12. L220 (api.js): `email` property key passed to updateEmail template
13. L223 (api.js): `email` property key passed to signin email template
14. L23 (completion-email.ts): `recipient` field holding recipient email address
15. L72 (completion-email.ts): `email` field selecting email address from MemberImportRow
16. L102 (completion-email.ts): `email` object key mapping email address
17. L138 (completion-email.ts): `recipient` parameter holding recipient email address
18. L149 (completion-email.ts): `to` property key setting recipient email for email message
19. L157 (completion-email.ts): `emailRecipient` property key passing recipient email to renderer

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
