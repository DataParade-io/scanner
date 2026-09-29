# KDATAP-9929f9 Labeling Pass Report

## Files Labeled
- `ghost/core/core/server/services/members/members-api/repositories/member-repository.js`

## Summary
- Total records: 76
- Positive: 38
- Negative: 38
- Ambiguous: 0

## Positive Lines (38 records)

1. L202: Function parameter that receives and passes the member's email address to automation trigger.
2. L207: Passes the member's email address to the automations API trigger.
3. L284: Function parameter that receives and passes the member's email address.
4. L286: Passes the member's email address to the internal signup automation trigger.
5. L386: Object key holding the email address value from decoded token.
6. L396: Function parameter that receives the member's email address.
7. L401: Passes the email address in an object used for member lookup.
8. L446: String literal selecting the email address field from the data object.
9. L462: Reads the member's email address to validate it against email format rules.
10. L534: Reads the new member's email address to trigger signup automation.
11. L616: Object key holding the Stripe customer's email address.
12. L682: String literal selecting the email address field in _.pick for update data.
13. L734: Reads the initial member's email address to check if it has been changed.
14. L735: Reads the updated member's email address to check if it has been changed.
15. L736: Compares initial and updated member email addresses to detect changes.
16. L737: Validates the updated member's email address against email format rules.
17. L960: Compares member's current and previous email addresses to detect changes.
18. L964: Object key holding the previous member email address in change event record.
19. L965: Object key holding the new member email address in change event record.
20. L983: Checks if the member's email address has changed to trigger Stripe update.
21. L989: Passes the member's email address to update the Stripe customer record.
22. L1160: Object key holding the email address for upserting a Stripe customer record.
23. L1182: Object key holding the Stripe customer's email address for adding to member.
24. L1198: Function parameter that receives an email address to look up Stripe customer ID.
25. L1199: Passes the email address to the Stripe API service to look up customer ID.
26. L1925: Reads the member's email address to trigger paid signup automation.
27. L2001: Object key for looking up a member by email address.
28. L2035: Checks if email address is provided to build a lookup query.
29. L2036: Object key for looking up a member by email address.
30. L2094: Checks if email address is provided to build a lookup query.
31. L2095: Object key for looking up a member by email address.
32. L2207: Checks if email address is provided to build a lookup query.
33. L2208: Object key for looking up a member by email address.
34. L2220: Reads and passes the email address to an error message when member lookup fails.
35. L2385: Object key holding the member's email address for creating a Stripe customer.
36. L2392: Object key holding the Stripe customer's email address for adding customer record.
37. L2531: Object key holding the member's email address for creating a Stripe customer.
38. L2538: Object key holding the Stripe customer's email address for upserting customer record.

## Ambiguous Lines
None.

## Notes
All lines labeled without ambiguity. The positive lines consistently represent:
- Function parameters and local variables holding email addresses
- Object keys and properties storing email values
- Reads, passes, and validations of email addresses
- String literals selecting email fields in queries and updates

The negative lines are primarily:
- Module and model class names related to email features (but not addresses themselves)
- JSDoc comments and prose documentation
- Email-disabled flags and welcome email feature constants
- Error messages and property names in error objects

Validator output: OK

## Branch

Packet and labels: branch `label/KDATAP-9929f9`, `tests/benchmark/repos/ghost/annotations/packets/KDATAP-9929f9.yaml`.

## Coordinator review

76 records: 38 positive, 38 negative. Statuses were right in round 1; round 2 added missing declarations (all verified to resolve to the declaring line with the right kind). Validator OK.
