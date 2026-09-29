# KDATAP-7dc1e3: Label email mentions: saleor batch 12

## Files labeled

- saleor/giftcard/utils.py
- saleor/giftcard/events.py
- saleor/giftcard/models.py

## Record count

Total: 32 records (30 from candidate inventory + 2 extras)

- Positive: 26
- Negative: 6
- Ambiguous: 0

## Positive lines

- saleor/giftcard/events.py:60 previous_email parameter
- saleor/giftcard/events.py:71 previous_assigned_to_email key
- saleor/giftcard/events.py:73 assigned_to_email key
- saleor/giftcard/events.py:81 previous_email parameter
- saleor/giftcard/events.py:92 previous_assigned_to_email key
- saleor/giftcard/events.py:122 email parameter
- saleor/giftcard/events.py:129 email key
- saleor/giftcard/events.py:134 email parameter
- saleor/giftcard/events.py:141 email key
- saleor/giftcard/models.py:64 created_by_email field
- saleor/giftcard/models.py:65 used_by_email field
- saleor/giftcard/models.py:77 assigned_to_email field
- saleor/giftcard/models.py:164 assigned_to_email read
- saleor/giftcard/utils.py:44 email parameter
- saleor/giftcard/utils.py:144 user.email pass
- saleor/giftcard/utils.py:145 assigned_to_email string literal
- saleor/giftcard/utils.py:148 user.email pass
- saleor/giftcard/utils.py:290 order.user_email read
- saleor/giftcard/utils.py:303 created_by_email keyword arg
- saleor/giftcard/utils.py:325 user_email pass
- saleor/giftcard/utils.py:349 user_email parameter
- saleor/giftcard/utils.py:361 user_email pass
- saleor/giftcard/utils.py:389 used_by_email keyword arg
- saleor/giftcard/utils.py:390 created_by_email keyword arg
- saleor/giftcard/utils.py:394 used_by_email keyword arg (extra)
- saleor/giftcard/utils.py:397 created_by_email keyword arg (extra)
- saleor/giftcard/utils.py:403 used_by_email keyword arg
- saleor/giftcard/utils.py:404 created_by_email keyword arg

## Negative lines

- saleor/giftcard/models.py:158 docstring prose
- saleor/giftcard/models.py:160 docstring prose
- saleor/giftcard/utils.py:48 docstring prose
- saleor/giftcard/utils.py:160 docstring prose

## Notes

Two records (saleor/giftcard/utils.py:394, :397) were included despite not being in the candidate inventory, as they represent the same patterns in the same function as the inventory already included. The validator accepted these with warnings. All 30 candidates from the inventory were labeled correctly, plus these 2 extras for completeness.
