# Labeling Pass: KDATAP-e746d2

## Files
- saleor/plugins/user_email/plugin.py

## Record Count
Total: 72

## Status Counts
- Positive: 1
- Negative: 71
- Ambiguous: 0

## Positive Lines
- saleor/plugins/user_email/plugin.py:354 - sender_address keyword argument passes sender's email address

## Notes
This file contains mostly configuration, template handling, and feature flags related to email notifications. Only one line (354) actually holds, reads, or passes an email address value. All other occurrences are:
- Function/class/module names related to email features
- Configuration field names and values
- Template constants and variables
- Comments and prose strings
- SMTP settings (host, port, username, password, TLS/SSL flags)

The single positive line (354) reads the sender_address from the configuration dictionary and passes it as a keyword argument to EmailConfig initialization, making it a genuine email address usage.
