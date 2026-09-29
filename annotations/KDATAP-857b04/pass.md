# KDATAP-857b04: Label email mentions - saleor batch 5

## Files

- saleor/plugins/admin_email/notify_events.py

## Record count

- Total: 46
- Positive: 13
- Negative: 33
- Ambiguous: 0

## Positive lines

The following 13 lines read, write, pass, or check email addresses:

1. saleor/plugins/admin_email/notify_events.py:31 - Extract recipient email from payload
2. saleor/plugins/admin_email/notify_events.py:38 - Pass recipient email to task
3. saleor/plugins/admin_email/notify_events.py:55 - Extract recipient email from payload
4. saleor/plugins/admin_email/notify_events.py:56 - Check if recipient email is set
5. saleor/plugins/admin_email/notify_events.py:64 - Pass recipient email to task
6. saleor/plugins/admin_email/notify_events.py:81 - Extract recipient list from payload
7. saleor/plugins/admin_email/notify_events.py:88 - Pass recipient list to task
8. saleor/plugins/admin_email/notify_events.py:105 - Extract recipient email from payload
9. saleor/plugins/admin_email/notify_events.py:106 - Check if recipient email is set
10. saleor/plugins/admin_email/notify_events.py:114 - Pass recipient email to task
11. saleor/plugins/admin_email/notify_events.py:131 - Extract recipient email from payload
12. saleor/plugins/admin_email/notify_events.py:132 - Check if recipient email is set
13. saleor/plugins/admin_email/notify_events.py:140 - Pass recipient email to task

## Negative lines

The remaining 33 lines are negative: imports, template assignments, subject assignments, function declarations, constants, and task calls that do not directly hold address values.

## Notes

All candidate lines from the file were analyzed. The labeling follows the rules in the reference documentation, with consistent application of email address identification criteria. Task function names and module imports are marked negative per rule 2 and rule 4.
