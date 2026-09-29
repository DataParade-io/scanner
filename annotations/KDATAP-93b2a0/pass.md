# Label email mentions: saleor batch 2

## Files
- saleor/plugins/user_email/tasks.py

## Record count
- Total: 105
- Positive: 38
- Negative: 67
- Ambiguous: 0

## Positive lines
All positive lines hold email addresses as function parameters, keyword arguments, or object keys that pass recipient email addresses to sending functions or event logging:

- saleor/plugins/user_email/tasks.py:13: recipient_email (parameter)
- saleor/plugins/user_email/tasks.py:19: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:33: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:46: recipient_email (parameter)
- saleor/plugins/user_email/tasks.py:53: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:62: email (object key)
- saleor/plugins/user_email/tasks.py:63: recipient_email (object key)
- saleor/plugins/user_email/tasks.py:70: recipient_email (parameter)
- saleor/plugins/user_email/tasks.py:77: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:83: email (object key)
- saleor/plugins/user_email/tasks.py:84: email (object key)
- saleor/plugins/user_email/tasks.py:94: recipient_email (parameter)
- saleor/plugins/user_email/tasks.py:99: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:108: recipient_email (parameter)
- saleor/plugins/user_email/tasks.py:113: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:125: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:134: recipient_email (object key)
- saleor/plugins/user_email/tasks.py:149: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:159: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:165: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:171: recipient_email (parameter)
- saleor/plugins/user_email/tasks.py:177: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:186: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:192: recipient_email (parameter)
- saleor/plugins/user_email/tasks.py:197: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:207: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:213: recipient_email (parameter)
- saleor/plugins/user_email/tasks.py:218: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:227: recipient_email (parameter)
- saleor/plugins/user_email/tasks.py:232: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:241: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:250: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:260: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:269: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:279: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:285: recipient_email (parameter)
- saleor/plugins/user_email/tasks.py:290: recipient_email (keyword arg)
- saleor/plugins/user_email/tasks.py:300: recipient_email (keyword arg)

## Notes
All negative lines were function names (naming functions after email sending tasks), class names (EmailConfig), method names (for event logging), import statements, docstring prose, or configuration keyword argument names that do not themselves hold email addresses.

No ambiguous lines were encountered.
