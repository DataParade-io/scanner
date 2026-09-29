# KDATAP-66078d Pass Record

## Files Labeled
- `ghost/core/core/server/services/email-address/email-address-service.ts`

## Record Count
- Total: 86
- Positive: 43
- Negative: 43
- Ambiguous: 0

## Positive Lines
1. ghost-email-address-service-L7: Type field holding the from email address
2. ghost-email-address-service-L8: Type field holding the reply-to email address
3. ghost-email-address-service-L26: Private method that provides the default email address
4. ghost-email-address-service-L28: Private method that provides fallback email address
5. ghost-email-address-service-L30: Private method that validates email addresses
6. ghost-email-address-service-L38: Constructor dependency that provides a support email address
7. ghost-email-address-service-L39: Constructor dependency for email validation
8. ghost-email-address-service-L44: Assignment storing the function that provides default email address
9. ghost-email-address-service-L46: Assignment storing arrow function that provides fallback email address
10. ghost-email-address-service-L47: Stores result of getting fallback email address
11. ghost-email-address-service-L51: Parsing fallback email address string
12. ghost-email-address-service-L53: Assignment storing the email validation function
13. ghost-email-address-service-L68: Getter that returns the default from email address
14. ghost-email-address-service-L69: Getting the default email address
15. ghost-email-address-service-L72: Getter that returns the fallback email address
16. ghost-email-address-service-L73: Getting the fallback email address
17. ghost-email-address-service-L83: Reading the sender address from transformed email
18. ghost-email-address-service-L86: Method parameter holding from email address string
19. ghost-email-address-service-L87: Parsing from email address string
20. ghost-email-address-service-L88: Parsing reply-to email address string
21. ghost-email-address-service-L91: Using parsed from email in object
22. ghost-email-address-service-L105: Method parameter holding email addresses
23. ghost-email-address-service-L108: Reading and validating reply-to email address
24. ghost-email-address-service-L116: Comparing email addresses for equality
25. ghost-email-address-service-L128: Reading and validating from email address
26. ghost-email-address-service-L131: Using default from email address
27. ghost-email-address-service-L143: Reading fallback email address
28. ghost-email-address-service-L144: Checking if fallback email exists
29. ghost-email-address-service-L145: Reading email name from fallback address
30. ghost-email-address-service-L146: Setting email name on fallback address
31. ghost-email-address-service-L150: Using fallback email address
32. ghost-email-address-service-L151: Using reply-to or from email address
33. ghost-email-address-service-L161: Comparing from email addresses
34. ghost-email-address-service-L164: Setting email sender name
35. ghost-email-address-service-L172: Reading from email address to check domain
36. ghost-email-address-service-L186: Using default from email address
37. ghost-email-address-service-L195: Comparing reply-to and from email addresses
38. ghost-email-address-service-L197: Using from email address
39. ghost-email-address-service-L207: Method that validates email address
40. ghost-email-address-service-L208: Validating email address
41. ghost-email-address-service-L211: Comparing email to default address
42. ghost-email-address-service-L227: Reading email to check sending domain
43. ghost-email-address-service-L241: Comparing email to default address
44. ghost-email-address-service-L247: Comparing email to default address

## Notes
- All 86 candidates for `email-address-service.ts` were labeled according to the mention-attribute-labeling reference
- The labeling focuses on distinguishing between actual email address values/operations vs email-related functionality
- Comments, docstrings, and prose error messages were labeled as negative
- Type annotations and email validation functions were labeled as positive when they directly handle email addresses
- Constructor dependencies for email handling were labeled based on their purpose (positive for address provision/validation)
- Validator confirmed OK with 86 records matching 86 candidates
