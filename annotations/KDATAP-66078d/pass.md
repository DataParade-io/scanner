# KDATAP-66078d Pass Record

## Files Labeled
- `ghost/core/core/server/services/email-address/email-address-service.ts`

## Record Count
- Total: 86
- Positive: 39
- Negative: 47
- Ambiguous: 0

## Positive Lines with Declarations and Type Annotations
- All 39 positive lines have declarations where required (identifiers and property_keys)
- 22 positive lines have type_annotation

## Positive Lines
1. ghost-email-address-service-L7: Type field `from` holds email address
2. ghost-email-address-service-L8: Type field `replyTo` holds email address
3. ghost-email-address-service-L47: Stores result of getting fallback email
4. ghost-email-address-service-L51: Parsing fallback email address string
5. ghost-email-address-service-L68: Getter returns default from email address
6. ghost-email-address-service-L69: Getting default email address via call
7. ghost-email-address-service-L72: Getter returns fallback email address
8. ghost-email-address-service-L73: Getting fallback email address via call
9. ghost-email-address-service-L83: Reading sender address from transformed email
10. ghost-email-address-service-L86: Parameter holding from email address string
11. ghost-email-address-service-L87: Parsing from email address string
12. ghost-email-address-service-L88: Parsing reply-to email address string
13. ghost-email-address-service-L91: Using parsed from email in object
14. ghost-email-address-service-L105: Parameter holding email addresses
15. ghost-email-address-service-L108: Reading and validating reply-to email address
16. ghost-email-address-service-L116: Comparing email addresses for equality
17. ghost-email-address-service-L117: Error message logging invalid reply-to address (interpolates value)
18. ghost-email-address-service-L120: Warning message about reply-to validation (interpolates value)
19. ghost-email-address-service-L128: Reading and validating from email address
20. ghost-email-address-service-L131: Using default from email address
21. ghost-email-address-service-L143: Reading fallback email address
22. ghost-email-address-service-L144: Checking if fallback email exists
23. ghost-email-address-service-L145: Reading email name from fallback address
24. ghost-email-address-service-L146: Setting email name on fallback address
25. ghost-email-address-service-L150: Using fallback email address
26. ghost-email-address-service-L151: Using reply-to or from email address
27. ghost-email-address-service-L161: Comparing from email addresses
28. ghost-email-address-service-L164: Setting email sender name
29. ghost-email-address-service-L172: Reading from email address to check domain
30. ghost-email-address-service-L180: Warning message about sending domain (interpolates value)
31. ghost-email-address-service-L186: Using default from email address
32. ghost-email-address-service-L195: Comparing reply-to and from email addresses
33. ghost-email-address-service-L197: Using from email address
34. ghost-email-address-service-L207: Parameter holding email string for validation
35. ghost-email-address-service-L208: Validating email address
36. ghost-email-address-service-L211: Comparing email to default address
37. ghost-email-address-service-L227: Reading email to check sending domain
38. ghost-email-address-service-L241: Comparing email to default address
39. ghost-email-address-service-L247: Comparing email to default address

## Key Corrections Applied
1. Functions/methods named after the concept (getDefaultEmail, getFallbackEmail, isValidEmailAddress) marked negative on declaration/type/assignment lines, positive where they return or pass values
2. Prose messages with interpolated email address values marked positive per rule 3 exception (lines 117, 120, 180)
3. Type-only occurrences use syntax_kind type_name instead of identifier
4. All positive identifier/property_key lines now have proper declarations
5. Type annotations added where the declaration has a written type
6. Pass file moved to repository-root annotations/ directory per updated requirements

## Validator Output
```
tests/benchmark/repos/ghost/annotations/packets/KDATAP-66078d.yaml: 86 records, 86 candidates
  OK
```
