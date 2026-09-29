# Pass Record for KDATAP-9f9810

## Labeling Summary

**Files Labeled:**
- `saleor/plugins/admin_email/tasks.py`

**Total Records:** 31

**Status Breakdown:**
- **Positive:** 10 records
- **Negative:** 21 records
- **Ambiguous:** 0 records

## Positive Lines

The following 10 lines hold or pass email addresses:

- `saleor/plugins/admin_email/tasks.py:10` - Function parameter `recipient_email`
- `saleor/plugins/admin_email/tasks.py:15` - Passes `recipient_email` to send_email
- `saleor/plugins/admin_email/tasks.py:24` - Function parameter `recipient_email: str`
- `saleor/plugins/admin_email/tasks.py:29` - Passes `recipient_email` to send_email
- `saleor/plugins/admin_email/tasks.py:43` - Function parameter `recipient_email: str`
- `saleor/plugins/admin_email/tasks.py:48` - Passes `recipient_email` to send_email
- `saleor/plugins/admin_email/tasks.py:62` - Function parameter `recipient_list: str` holding staff email addresses
- `saleor/plugins/admin_email/tasks.py:67` - Passes `recipient_list` to send_email
- `saleor/plugins/admin_email/tasks.py:76` - Function parameter `recipient_email`
- `saleor/plugins/admin_email/tasks.py:81` - Passes `recipient_email` to send_email

## Negative Lines

The following 21 lines do not hold email addresses:

- `saleor/plugins/admin_email/tasks.py:5` - Import of send_email module
- `saleor/plugins/admin_email/tasks.py:9` - Function name indicates email sending feature
- `saleor/plugins/admin_email/tasks.py:12` - EmailConfig object assignment
- `saleor/plugins/admin_email/tasks.py:13` - send_email function call
- `saleor/plugins/admin_email/tasks.py:14` - Configuration keyword argument
- `saleor/plugins/admin_email/tasks.py:23` - Function declaration with email feature name
- `saleor/plugins/admin_email/tasks.py:26` - EmailConfig object assignment
- `saleor/plugins/admin_email/tasks.py:27` - send_email function call
- `saleor/plugins/admin_email/tasks.py:28` - Configuration keyword argument
- `saleor/plugins/admin_email/tasks.py:42` - Function declaration with email feature name
- `saleor/plugins/admin_email/tasks.py:45` - EmailConfig object assignment
- `saleor/plugins/admin_email/tasks.py:46` - send_email function call
- `saleor/plugins/admin_email/tasks.py:47` - Configuration keyword argument
- `saleor/plugins/admin_email/tasks.py:61` - Function declaration with email feature name
- `saleor/plugins/admin_email/tasks.py:64` - EmailConfig object assignment
- `saleor/plugins/admin_email/tasks.py:65` - send_email function call
- `saleor/plugins/admin_email/tasks.py:66` - Configuration keyword argument
- `saleor/plugins/admin_email/tasks.py:75` - Function declaration with email feature name
- `saleor/plugins/admin_email/tasks.py:78` - EmailConfig object assignment
- `saleor/plugins/admin_email/tasks.py:79` - send_email function call
- `saleor/plugins/admin_email/tasks.py:80` - Configuration keyword argument

## Key Observations

- All 5 task functions (`send_set_staff_password_email_task`, `send_email_with_link_to_download_file_task`, `send_export_failed_email_task`, `send_staff_order_confirmation_email_task`, `send_staff_password_reset_email_task`) follow the same pattern: they declare a parameter holding email address(es), create an EmailConfig object, and pass that parameter to send_email.
- Each of the 5 functions contributes 2 positive lines: the parameter declaration line and a line passing that parameter to send_email (10 total positive).
- Parameters named `recipient_email` or `recipient_list` are consistently labeled positive as they hold email addresses.
- Function declarations with "email" in the name are labeled negative per the rule that function names indicating the feature (sending email) are not addresses.
- EmailConfig assignments and configuration arguments are consistently negative as they hold configuration objects, not addresses.
- No ambiguous cases were encountered. All lines fit clearly into the established rules.

## Validation Result

✓ Validator printed OK: 31 records, 31 candidates
