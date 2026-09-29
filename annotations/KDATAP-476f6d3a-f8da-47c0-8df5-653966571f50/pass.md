# KDATAP-476f6d Pass Report

## Files Labeled
- ghost/core/core/server/api/endpoints/utils/validate-email-sender-fields.ts
- ghost/core/core/server/services/mail/ghost-mailer.js

## Record Count
Total records: 43

## Label Counts
- Positive: 13
- Negative: 30
- Ambiguous: 0

## Positive Lines
1. ghost-validate-email-sender-fields-L19: sender_email parameter
2. ghost-validate-email-sender-fields-L20: sender_reply_to parameter
3. ghost-validate-email-sender-fields-L29: validate method call
4. ghost-ghost-mailer-L36: requestedFromAddress parameter
5. ghost-ghost-mailer-L37: requestedFromAddress parameter use
6. ghost-ghost-mailer-L39: requestedFromAddress assignment
7. ghost-ghost-mailer-L43: getAddressFromString method call
8. ghost-ghost-mailer-L44: requestedFromAddress parameter
9. ghost-ghost-mailer-L57: from property (sender address)
10. ghost-ghost-mailer-L58: replyTo property (reply-to address)
11. ghost-ghost-mailer-L80: from property (sender address parameter)
12. ghost-ghost-mailer-L88: from property (email header)

## Validator Output
OK

## Notes
All candidates matched exactly with 43 records created. No ambiguous entries needed. The labeling correctly identifies addresses held in parameters, passed to functions, or stored in properties. Function and method names that reference email concepts are correctly marked negative per the reference guidelines.

## Branch

`label/KDATAP-476f6d` (7a7ad3b).

## Coordinator review

43 records: 12 positive, 31 negative. Statuses accepted; coordinator fixed subject names to the concept token on 29, 43, 57, 58, 80, 88 and set 19-20 as typed fields of the data parameter. Validator OK.
