# Email label agreement check (KDATAP-6b03c5)

A blind second pass by a different, stronger model (Sonnet) re-labeled a random 20% of the Haiku-labeled email candidate lines and was compared field by field with the final (coordinator-reviewed) labels. Full output: `comparison.txt`. Second-pass packets: `tests/benchmark/repos/*/annotations/packets/SP-*.yaml`.

## Sample

304 lines (ghost 175, saleor 129), 20% of each of the 27 batch packets, seed 6. The worked example (ghost batch 3) was excluded because it is visible on the labeling base. The second pass ran on `kdatap-6b03c5-second-pass`, which does not contain the earlier labels. 0 of 304 second-pass rationales match earlier rationales verbatim.

## Agreement

| Comparison | Status | kappa | syntax_kind* | declaration* | type_annotation* |
| --- | --- | --- | --- | --- | --- |
| Second pass vs final labels | 296/304 (97.4%) | 0.941 | 86.3% | 76.8% | 94.7% |
| Second pass vs Haiku draft | 293/304 (96.4%) | 0.919 | 83.9% | 73.1% | 92.5% |
| Haiku draft vs final labels | 301/304 (99.0%) | 0.977 | 97.9% | 95.9% | 95.9% |

\* over lines both sides label positive.

Status agreement is high. The coordinator review moved the Haiku labels slightly toward the independent labeler (96.4% to 97.4%).

## Status disagreements (8)

- 2 were errors in the final labels and are fixed: `validate-email-sender-fields.ts:7` (`field: 'sender_email'` selects the address field: positive) and `sending-service.js:138` (`recipients` is a list of recipient objects: negative).
- 6 were marked ambiguous by the second pass where the reference has no rule. The final labels are consistent on each:
  - a line that only opens a container whose later key holds an address (`email_data = {`): negative; the address is positive on its own line
  - an index name containing the concept (`name="order_user_email_user_id_idx"`): negative
  - a setting that holds a keyword or an address (`sender_reply_to`): positive
  - a function whose address parameters lack the concept token (`getAddressFromString(from: string, replyTo?: string)`): positive, occurrence is the return type

## Attribute disagreements

Mostly unsettled rules, not labeling errors:

- `validations: { isEmail: true }`: string_literal vs property_key (6)
- a key without the concept holding an address (`to: email`, `from: this.defaultFromEmail`): key vs value occurrence (5)
- shorthand keys `{ email }`: key (this line) vs the parameter it came from (3)
- getter declaration kind: field vs function (2)
- `this.get('email')` in a model: unresolved vs a local (2)

One was an error in the final labels and is fixed: `user.js:1280` now resolves `user` to the callback parameter on line 1279.

## Recommendation

Settle the open rules in the labeling reference, then apply them mechanically to all packets (a normalization pass) instead of relabeling. Status labels are reliable enough for headline mention precision and recall now; attribute metrics should wait for the normalization pass.
