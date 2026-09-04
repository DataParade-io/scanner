# Proposal

## Fixture or repository

`tests/fixtures/terraform-basic`

## What we expect to find

`main.tf` line 29 sets `DATABASE_URL = aws_db_instance.main.address`. That `.address` attribute is a Terraform hostname, not a postal address. The PII matcher must not emit address raw-hits, mentions, or data items on that line.

Verified against the personal-data collector: no `raw_hit:address`, `mention:address`, or `data_item:address`. The current `address` heuristic only matches tokens such as `street_address`, `mailing_address`, and `postal_code` — not a bare `.address` — so this negative does not exercise a near-miss false-positive path. The gold is still correct: this line must stay clean.

## Human review

Reviewed against fixture source, PII rules, and live scan output. Advanced off proposed after that check.
