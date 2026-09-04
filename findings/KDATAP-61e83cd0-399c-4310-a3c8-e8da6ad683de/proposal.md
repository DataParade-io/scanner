# Proposal

## Fixture or repository

Multiple fixtures: `typescript-basic`, `python-basic`, `terraform-basic`, `dotnet-manifests-basic`.

## What we expect to find

The scanner must NOT emit `actor:user` with no source locations. On these fixtures there is no user-actor evidence (no inbound request handler that names a user). The phantom `actor:user` enters the precision denominator but cannot match span-based gold, lowering precision without representing a real detection.

Verified against `scan()`: `actor:user` appears with empty `sourceLines` on all four fixtures. Tracked by bug KDATAP-45b320.

## Human review

Reviewed against live scan output. The expectation (negative) is correct. Advanced off proposed after that check.
