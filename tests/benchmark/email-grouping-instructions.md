# Email declaration grouping (KDATAP-5739c5 ghost, KDATAP-8ab5e2 saleor)

Group the positive email mentions of one repo into distinct data items: which email address is it, and whose. The result is gold for the declaration-grouping layer (pairwise precision and recall over mention pairs).

## Input

`tests/benchmark/repos/<repo>/annotations/packets/email-grouping-input.yaml`. Every positive mention is listed once, already clustered by shared declaration: mentions that point at the same declaration are the same data by construction and share a cluster id (`c001` ...). Mentions with no shared declaration (field selectors, keys declared on their own line, schema columns) are single-mention clusters.

Read the source at the pinned commit (`pnpm run benchmark:materialize <repo>`, then `tests/benchmark/.cache/repos/<repo>@<commit>/`).

## Task

Assign every cluster to exactly one group, or to `needs_adjudication`.

Link two clusters into one group only when the source shows they hold the same address of the same subject:

- the same model column or field: the column or model field definition, and reads or writes of that field on instances of that model (`member.get('email')`, `user.email` where `user` is that model), and query field selectors on it (`'members.email'`, `filter(email=...)` on that model)
- the value flows between them: passed as an argument, assigned, returned, put into a payload or dict key that is read elsewhere, or imported through a relative import
- the same request, payload, or settings field read in several places

Similar names alone are not evidence. Different subjects are different groups even when the field name is the same: a member's email, a staff user's email, a customer's order email, the site's configured sender address, and a gift card recipient's email are different data items. A stored copy is its own data item: an order's `user_email` copied from the user's account email is a separate group, and the rationale notes where it is copied from.

When a cluster could belong to more than one group and the source does not settle it, put it in `needs_adjudication` with the candidate groups and the reason. Do not force it.

## Output

`tests/benchmark/repos/<repo>/annotations/packets/email-groups.yaml`:

```yaml
repo: ghost
concept: email
provenance:
  proposed_by: claude-sonnet-5
  proposed_at: '2026-09-29'
  review_state: proposed
groups:
  - id: member-account-email          # kebab-case, stable
    name: Member account email
    subject: member                   # whose address: member, staff user, customer, site, gift card recipient, ...
    purpose: sign-in, newsletters, and member communication
    rationale: members.email column (schema.js:500) is read as member.get('email') in ... and passed to ...
    clusters: [c012, c045, c101]
needs_adjudication:
  - cluster: c077
    candidate_groups: [member-account-email, staff-user-email]
    reason: the value comes from a request body whose type does not say which
```

Each group also has `subject_kind`, from a closed list, so reports can filter on whose address it is:

| subject_kind | Meaning |
| --- | --- |
| `end_user` | A customer, member, or other user of the product |
| `workforce` | Staff, admins, employees |
| `other_person` | A person who is not necessarily a user (gift recipient, donor) |
| `organization` | An address the organization configures for itself (sender, support, reply-to) |
| `machine_identity` | A service account or integration identity |

Every group keeps its mentions in the knowledge base whatever its `subject_kind`; hiding or routing a group (for example leaving `organization` addresses out of a privacy inventory) belongs to the report that uses it.

Every input cluster appears exactly once across `groups[*].clusters` and `needs_adjudication`. Group ids are unique. A group may hold a single cluster.
