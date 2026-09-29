# Pass Report: KDATAP-7e5cf2

## Files Labeled
- saleor/plugins/sendgrid/tasks.py

## Record Count
- Total records: 57
- Positive: 16
- Negative: 41
- Ambiguous: 0

## Positive Lines (Email Address Mentions)
1. saleor/plugins/sendgrid/tasks.py:23 - recipient_email (extracts email from payload dict)
2. saleor/plugins/sendgrid/tasks.py:25 - sender_address (reads sender address from configuration)
3. saleor/plugins/sendgrid/tasks.py:26 - recipient_email (passes recipient email to Mail constructor)
4. saleor/plugins/sendgrid/tasks.py:88 - old_email (extracts old email from payload)
5. saleor/plugins/sendgrid/tasks.py:89 - recipient_email (extracts recipient email as new_email value)
6. saleor/plugins/sendgrid/tasks.py:109 - old_email (extracts old email from payload)
7. saleor/plugins/sendgrid/tasks.py:110 - new_email (extracts new email from payload)
8. saleor/plugins/sendgrid/tasks.py:167 - recipient_email (passes recipient email as customer_email parameter)
9. saleor/plugins/sendgrid/tasks.py:173 - recipient_email (passes recipient email as email parameter)
10. saleor/plugins/sendgrid/tasks.py:195 - recipient_email (passes recipient email as customer_email parameter)
11. saleor/plugins/sendgrid/tasks.py:217 - recipient_email (passes recipient email as customer_email parameter)
12. saleor/plugins/sendgrid/tasks.py:253 - recipient_email (passes recipient email as customer_email parameter)
13. saleor/plugins/sendgrid/tasks.py:275 - recipient_email (passes recipient email as customer_email parameter)
14. saleor/plugins/sendgrid/tasks.py:297 - recipient_email (passes recipient email as customer_email parameter)
15. saleor/plugins/sendgrid/tasks.py:318 - recipient_email (adds recipient email as email field in dict)
16. saleor/plugins/sendgrid/tasks.py:345 - recipient_email (passes recipient email as customer_email parameter)

## Notes
All candidates were straightforward to classify. No ambiguous lines were found. The labeling applied the rules consistently:
- Function declarations/names mentioning "email" were marked negative unless they had parameters holding email addresses
- All dictionary key accesses and function parameters passing email addresses were marked positive
- Docstring text and function names without address values were marked negative
- Template ID references and configuration field names were marked negative as they refer to settings, not addresses
