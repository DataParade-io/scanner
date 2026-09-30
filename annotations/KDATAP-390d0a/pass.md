# KDATAP-390d0a: Email Mentions Labeling - Directus Batch 5

## Files Labeled
- api/src/cli/commands/init/index.ts
- api/src/database/migrations/20211118A-add-notifications.ts
- api/src/operations/mail/index.ts
- api/src/operations/notification/index.ts
- api/src/services/export.ts
- api/src/services/graphql/resolvers/system-global.ts
- api/src/services/graphql/resolvers/system.ts
- api/src/services/import/import.ts
- api/src/services/server.ts
- api/src/license/manager.ts
- api/src/websocket/collab/room.ts

## Summary
Total records labeled: 61
- Positive: 13
- Negative: 48
- Ambiguous: 0

## Notes

### Positive Labels (13 records)
Email address values that are read, written, validated, or passed to services:

1. **User account email fields** (4 records):
   - `api/src/cli/commands/init/index.ts:111` - Admin user email from initialization input
   - `api/src/license/manager.ts:651` - Admin user email read for license validation
   - `api/src/license/manager.ts:656` - Admin user email null check
   - `api/src/services/export.ts:183` - User email field selected for export completion notification

2. **GraphQL schema and argument handling** (8 records):
   - `api/src/services/graphql/resolvers/system-global.ts:60` - Email field in password reset mutation schema
   - `api/src/services/graphql/resolvers/system-global.ts:234` - Email field in user invite mutation schema
   - `api/src/services/graphql/resolvers/system-global.ts:250` - Email arg passed to password reset
   - `api/src/services/graphql/resolvers/system-global.ts:434` - Email field in user create mutation schema
   - `api/src/services/graphql/resolvers/system-global.ts:450` - Email arg passed to user creation
   - `api/src/services/graphql/resolvers/system.ts:559` - Email field in user invite mutation schema
   - `api/src/services/graphql/resolvers/system.ts:569` - Email arg passed to user invite service
   - `api/src/services/import/import.ts:197` - User email field selected for import completion notification

### Negative Labels (48 records)
Email-related mentions that do not handle actual email addresses:

1. **Notification system** (10 records):
   - `api/src/operations/notification/index.ts:8,20,46,48,49` - Recipient/sender user IDs for notifications
   - `api/src/database/migrations/20211118A-add-notifications.ts:11,12` - Recipient/sender foreign keys
   - `api/src/services/export.ts:195,196,212,213` - Recipient/sender user IDs for notifications
   - `api/src/services/import/import.ts:201,202` - Recipient/sender user IDs for notifications

2. **Email notification flags** (4 records):
   - `api/src/database/migrations/20211118A-add-notifications.ts:20,23,30` - Email notification boolean flag
   - `api/src/services/graphql/resolvers/system.ts:63` - Public registration email verification flag

3. **Email service configuration and features** (15 records):
   - `api/src/cli/commands/init/index.ts:77,78,81,82,83` - Email prompt setup and validation
   - `api/src/operations/mail/index.ts:3,6,29,32` - Email imports and type definitions
   - `api/src/services/server.ts:82,252,445,446,451,454,463,464` - Email service health checks and status

4. **WebSocket collaboration** (13 records):
   - `api/src/websocket/collab/room.ts:479,494,519,532,581,604,610,611,618,622,633,645` - WebSocket sender/recipient client handling (user UIDs, not addresses)

5. **License manager** (2 records):
   - `api/src/license/manager.ts:654,657` - Missing email error codes
   - `api/src/license/manager.ts:717` - Comment about admin email setting

## Validation
Packet validated successfully with no errors. All 61 records match candidates.

## Labeling Decisions

### Key Categorization Rules Applied

1. **Recipient/Sender in Notifications**: All recipient/sender references in the notification system store user IDs, not email addresses. These are consistently marked as negative. The notification system uses user IDs for accountability tracking, not email routing.

2. **GraphQL Arguments and Schema**: Email fields in GraphQL mutation arguments that accept and pass email addresses are marked as positive. These represent the actual email address input to user management operations.

3. **Email Service Configuration**: Feature names, service checks, and configuration flags related to email (like `email_notifications`, `testEmail()`, `EMAIL_VERIFY_SETUP`) are marked as negative, as they control the email service feature, not address values.

4. **User Record Fields**: Queries that select the email column from user records are marked as positive, as they retrieve actual email address values.

5. **Imports and Type Definitions**: Import statements and type names are consistently marked as negative, per the labeling rules.

### No Ambiguous Labels

All 61 candidates could be definitively classified based on the context and the explicit rules provided. The rules were sufficiently clear that no ambiguous classifications were necessary.
