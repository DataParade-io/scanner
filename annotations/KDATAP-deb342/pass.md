# Pass: KDATAP-deb342

## Files labeled
- ghost/core/core/server/api/endpoints/emails.js
- ghost/core/core/server/services/comments/comments-service-emails.js

## Record count
Total: 49
- Positive: 15
- Negative: 34
- Ambiguous: 0

## Positive lines
1. ghost/core/core/server/services/comments/comments-service-emails.js:65 - Compares author and member email addresses
2. ghost/core/core/server/services/comments/comments-service-emails.js:69 - Reads author's email for notification
3. ghost/core/core/server/services/comments/comments-service-emails.js:88 - Sets sender email (fromEmail)
4. ghost/core/core/server/services/comments/comments-service-emails.js:89 - Sets recipient email (toEmail)
5. ghost/core/core/server/services/comments/comments-service-emails.js:136 - Reads parent member's email
6. ghost/core/core/server/services/comments/comments-service-emails.js:166 - Sets sender email (fromEmail)
7. ghost/core/core/server/services/comments/comments-service-emails.js:167 - Sets recipient email (toEmail)
8. ghost/core/core/server/services/comments/comments-service-emails.js:179 - Sets recipient field (to)
9. ghost/core/core/server/services/comments/comments-service-emails.js:202 - Reads owner's email
10. ghost/core/core/server/services/comments/comments-service-emails.js:220 - Stores reporter's email (reporterEmail)
11. ghost/core/core/server/services/comments/comments-service-emails.js:221 - Interpolates reporter's email into string
12. ghost/core/core/server/services/comments/comments-service-emails.js:224 - Stores member's email (memberEmail)
13. ghost/core/core/server/services/comments/comments-service-emails.js:228 - Sets sender email (fromEmail)
14. ghost/core/core/server/services/comments/comments-service-emails.js:229 - Sets recipient email (toEmail)
15. ghost/core/core/server/services/comments/comments-service-emails.js:282 - Sets sender address in message

## Notes
All lines labeled straightforwardly according to the reference rules. The emails.js file contained only module imports, model names, service references, and template data structures - all negative. The comments-service-emails.js file had actual email address reads and property assignments that were labeled positive. No ambiguous lines encountered.
