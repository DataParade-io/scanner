# Mention attribute labeling

How to label candidate lines for one concept in one labeling batch. Written so a small model can follow it without judgment calls it cannot make. When a rule here does not settle a line, answer `ambiguous` with a one-sentence rationale. Never guess.

The worked example is `tests/benchmark/repos/ghost/annotations/packets/example-ghost-batch-3.yaml`. Read it after this page and copy its style.

## Rules

1. Label only the files listed in your batch issue.
2. Read each file at the pinned commit from the materialized checkout `tests/benchmark/.cache/repos/<repo>@<commit>/`. Materialize it first with `pnpm run benchmark:materialize <repo>` if it is missing.
3. Your input is the entries for your files in `tests/benchmark/repos/<repo>/annotations/packets/<concept>-candidates.yaml`. Write exactly one record per candidate line.
4. Write only your packet file, `tests/benchmark/repos/<repo>/annotations/packets/<your-issue-id>.yaml`. Do not edit any other file.
5. Do not run the scanner. Do not read scanner output, `annotations/mentions.yaml`, or other packets. Labels must not depend on what the scanner finds.
6. Read the surrounding code, not just the candidate line. Most decisions need the enclosing function and the lines above.
7. Before you finish, run `pnpm run benchmark:validate-packet <your packet>` and fix every error.

## Packet file

```yaml
packet:
  repo: ghost
  concept: email
  kanbus_issue: KDATAP-xxxxxx
  files:
    - ghost/core/core/server/models/member.js
annotations:
  - id: ghost-member-L650
    layer: mentions
    subject:
      key: mention:email
      name: email
    evidence:
      file_path: ghost/core/core/server/models/member.js
      start_line: 650
      end_line: 650
    expected:
      status: positive
      labels:
        - email_address
    rationale: Reads the member's email address to decide whether to build a Gravatar URL.
    provenance:
      proposed_by: <your model id>
      proposed_at: 'YYYY-MM-DD'
      review_state: proposed
    mention_attributes:
      syntax_kind: identifier
      declaration:
        file_path: ghost/core/core/server/models/member.js
        line: 644
        kind: local
      owner: ghost/core
```

Fixed values for the email concept: `subject.key: mention:email`, `expected.labels: [email_address]`, `layer: mentions`, `review_state: proposed`, and `start_line` equal to `end_line` equal to the candidate line.

- `id`: `<repo>-<file name without extension>-L<line>`. If two files in the batch share a name, add the parent directory: `ghost-endpoints-members-L81`.
- `subject.name`: the token exactly as written in the occurrence you chose (see syntax_kind), for example `requestUserEmail`, `email`, `email_recipients`.
- `rationale`: one sentence that says what the line does with the value, or what the word refers to instead.

## Field 1: `expected.status` (value or word)

Decide in this order. Stop at the first rule that applies.

1. **Comment or docstring.** The occurrence is inside a comment, a JSDoc block, or a Python docstring → `negative`. The scanner ignores comments, so a comment is never a real mention.
2. **Import.** The line imports or requires a module (`require('../../services/email-suppression-list')`, `from django.core.mail import send_mail`, `import sendgrid`) → `negative`.
3. **Prose.** The occurrence is human-readable text: an error or log message, a UI label, a translation string, template prose → `negative`. Example: `'Attempting to {action} member with existing email address.'`
4. **The word means a message or a feature, not an address.** Newsletter or post emails, email batches, email recipients as a relation, email counts and open rates, email types, whether to send email, email settings and flags, email templates, email events, a function or endpoint named after sending email → `negative`. Examples: `emails`, `email_recipients`, `email_count`, `email_open_rate`, `send_email`, `email_type`, `email_disabled`, `deleteEmailSuppression`, `sendEmail` (the name), `EmailRecipient`.
5. **The line holds, reads, writes, passes, validates, stores, or selects an email address** → `positive`. This includes:
   - a variable, parameter, property, or column that contains an address: `member.email`, `attrs.email`, `user_email`, `from_address`, `self.email`
   - an object key or keyword argument whose value is an address: `requestUserEmail: frame.user.get('email')`, `recipient_list=[user.email]`
   - a field definition or schema column for an address: `email = models.EmailField(unique=True)`, `email: {type: 'string', validations: {isEmail: true}}`
   - a field name that selects the address column or input: `'members.email'` in a query, `data: ['id', 'email']`, `email: { required: true }` in input validation
   - a template placeholder that renders an address: `{{ email }}`, `{{ user.email }}`
   - a sender or recipient address of any kind, including the site's own sender address (`from_address`, `DEFAULT_FROM_EMAIL`, `sender_email`). Whose address it is does not matter here.
6. **Anything else**, or you cannot tell whether the value is an address → `ambiguous`, with a rationale saying what is unclear.

A `recipient` or `sender` that is a person or member object, not an address, is `negative` under rule 4 unless the line also reads its address.

## Field 2: `mention_attributes.syntax_kind`

First choose the occurrence. On a positive line, choose the occurrence that holds or accesses the address. On any other line, choose the first occurrence of the concept on the line. Then:

| Kind | The chosen occurrence is | Examples |
| --- | --- | --- |
| `identifier` | a variable, parameter, function, or method name, or a property read after a dot | `email`, `member.email`, `emailSuppressionList`, `email_recipients()` |
| `property_key` | a key being defined: object literal key (quoted or not), class field, Django model field, keyword argument name | `email: { required: true }`, `'members.email_disabled': false`, `email = models.EmailField()` |
| `string_literal` | inside a quoted string or template string that is code, not prose | `'members.email'`, `['id', 'email']`, `'emails.post_id'` |
| `comment` | inside a comment, JSDoc, or docstring | `// the member's email` |
| `import_specifier` | inside an import or require path or name | `require('../email-suppression-list')` |
| `type_name` | a type or class name used as a type | `SignupEmailDto`, `EmailStr` |

Prose strings (rule 3 of status) use `string_literal`. Template placeholders use `identifier`.

## Field 3: `mention_attributes.declaration`

Record it only in these cases. Otherwise leave the field out.

1. **Identifier.** A bare name (`email`, `userEmail`): the line where that name is declared in this file (`const`, `let`, `var`, function parameter, Python assignment or parameter, class field). If it is imported from a relative module (`./` or `../`), the line of the matching export in that module. If it comes from a package import or cannot be found, write `unresolved`.
2. **Member access.** `x.email`, `x.get('email')`, `x['email']`, `self.email`: the declaration of the base `x` under rule 1. For `self` or `this`, the enclosing class's field definition of `email` if it is in this file, else `unresolved`.
3. **Object key or keyword argument that holds the address** (`requestUserEmail: frame.user.get('email')`): this line itself, kind `field`.
4. **Field definition** (`email = models.EmailField()`, a schema column): this line itself, kind `field`.

Never record a declaration for comments, imports, string literals, or negative lines.

`kind` is one of: `local` (`const`, `let`, `var`, or a Python local assignment), `parameter`, `field` (class field, model field, object key), `function`, `class`, `export`.

```yaml
declaration:
  file_path: ghost/core/core/server/api/endpoints/members.js
  line: 503
  kind: local
```

## Field 4: `mention_attributes.type_annotation`

Only when the declaration has a written type, write the type name as written: TypeScript `payload: SignupDto` → `SignupDto`, Python `email: str` → `str`. Never infer a type. JavaScript usually has none.

## Field 5: `mention_attributes.owner`

The path of the directory that contains the nearest package manifest at or above the file (`package.json`, `pyproject.toml`, `setup.py`, `go.mod`, `pom.xml`, `build.gradle`, `Gemfile`, `composer.json`, `*.csproj`), relative to the repository root. If the nearest manifest is at the repository root, use the repo key. The same value applies to every line in a file.

- `ghost/core/core/server/models/member.js` → `ghost/core`
- `saleor/account/models.py` → `saleor`

## Fields not labeled in batches

Do not write `touches` or `group`. They are labeled in later passes with a whole-repo view.

## Examples

| Line | status | syntax_kind | declaration |
| --- | --- | --- | --- |
| JS `const didRemove = await list.removeEmail(member.email);` (`member` from `const member = ...` on line 503) | positive | identifier | line 503, `local` |
| JS `requestUserEmail: frame.user ? frame.user.get('email') : null,` | positive | property_key | this line, `field` |
| JS `this.where('members.name', 'like', q).orWhere('members.email', ...` | positive | string_literal | none |
| JS `joinTable: 'email_recipients',` | negative | string_literal | none |
| JS `email_count: 0,` | negative | property_key | none |
| JS `// Get the member first to retrieve their email` | negative | comment | none |
| JS `const emailSuppressionList = require('../../services/email-suppression-list');` | negative | identifier | none |
| Python `email = models.EmailField(unique=True)` | positive | property_key | this line, `field` |
| Python `send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [user.email])` | positive | identifier | declaration of `user` |
| Python `def send_email_confirmation(user_pk: int, channel_slug: str):` | negative | identifier | none |
| Python `"""Send an email to the customer."""` | negative | comment | none |
| Python `EMAIL_CHANGE_EVENT = "email_changed"` (module constant naming an event) | negative | identifier | none |
| HTML template `<p>We received a request to change {{ old_email }}.</p>` | positive | identifier | none |

## Before you finish

- One record per candidate line, and no record for any other line unless the inventory clearly missed an occurrence (the validator warns; explain it in the rationale).
- Every positive line has `syntax_kind` and `owner`; identifiers and member access also have `declaration`.
- Every negative line has `syntax_kind` and `owner`, and no `declaration`.
- `pnpm run benchmark:validate-packet <your packet>` prints `OK`.
- Record the pass in `annotations/<your-issue-id>/pass.md`: files, record count, how many positive, negative, and ambiguous, and anything you were unsure about.
