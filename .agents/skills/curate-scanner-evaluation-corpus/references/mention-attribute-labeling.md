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
   Exception: if the same line puts an address value into that text (`` `Invalid replyTo address: ${preferred.replyTo.address}` ``, `f"sent to {user.email}"`, `tpl(msg, {id: data.email})`), the line writes the address into a log or message → `positive` under rule 5.
4. **The word means a message or a feature, not an address.** Newsletter or post emails, email batches, email recipients as a relation, email counts and open rates, email types, whether to send email, email settings and flags, email templates, email events, a function or endpoint named after sending email → `negative`. Examples: `emails`, `email_recipients`, `email_count`, `email_open_rate`, `send_email`, `email_type`, `email_disabled`, `deleteEmailSuppression`, `sendEmail` (the name), `EmailRecipient`.
   Functions and methods whose name mentions the concept are `negative` on the lines that declare, type, or assign the function itself, even when the function returns or validates an address: `#getDefaultEmail: () => EmailAddress;`, `this.#isValidEmailAddress = deps.isValidEmailAddress;`, `def send_email_confirmation(...)`. The address is `positive` where it is a value: a call that returns it into a variable (`const from = this.#getDefaultEmail();`), a call that passes it (`isValidEmailAddress(user.email)`), a getter or property that exposes it (`get defaultFromEmail()`), and `return` of it.
5. **The line holds, reads, writes, passes, validates, stores, or selects an email address** → `positive`. This includes:
   - a variable, parameter, property, or column that contains an address: `member.email`, `attrs.email`, `user_email`, `from_address`, `self.email`
   - an object key or keyword argument whose value is an address: `requestUserEmail: frame.user.get('email')`, `recipient_list=[user.email]`
   - a field definition or schema column for an address: `email = models.EmailField(unique=True)`, `email: {type: 'string', validations: {isEmail: true}}`
   - a field name that selects the address column or input: `'members.email'` in a query, `data: ['id', 'email']`, `email: { required: true }` in input validation
   - a template placeholder that renders an address: `{{ email }}`, `{{ user.email }}`
   - a sender or recipient address of any kind, including the site's own sender address (`from_address`, `DEFAULT_FROM_EMAIL`, `sender_email`). Whose address it is does not matter here.
6. **Anything else**, or you cannot tell whether the value is an address → `ambiguous`, with a rationale saying what is unclear.

The candidate list also matches related words: `recipient`, `sender`, `mailto`, `mail_to`, `from_address` (and camelCase or plural forms such as `fromAddress`, `recipients`, `StaffNotificationRecipient`). A line whose only occurrence is one of these words is judged by the same rules; it is never `ambiguous` just because the word `email` is absent.

A `recipient` or `sender` that is a person or member object, not an address, is `negative` under rule 4 unless the line also reads its address.

## Field 2: `mention_attributes.syntax_kind`

First choose the occurrence. On a positive line, take the first of these that exists:

1. a key, field, or parameter being defined that holds the address (`"recipient_email": user.email` → the key `recipient_email`; `def retrieve_user_by_email(email):` → the parameter `email`)
2. the expression that reads or passes the address (`urlencode({"token": t, "to": user.email})` → `user.email`)
3. a field name that selects the address (`'members.email'`)

On any other line, choose the first occurrence of the concept on the line. Then:

| Kind | The chosen occurrence is | Examples |
| --- | --- | --- |
| `identifier` | a variable, constant, parameter, function, or method name (including a module-level `NAME = ...` assignment), or a property read after a dot | `email`, `member.email`, `emailSuppressionList`, `email_recipients()`, `EMAIL_CHANGE_EVENT = ...` |
| `property_key` | a key being defined inside a class body, an object or dict literal (quoted or not), or a keyword argument name at a call site (`send(to=...)`). Not module-level assignments and not function parameters: parameters, including keyword-only `*, new_email: str`, are `identifier`. | `email: { required: true }`, `'members.email_disabled': false`, `email = models.EmailField()` in a model class |
| `string_literal` | inside a quoted string or template string that is code, not prose | `'members.email'`, `['id', 'email']`, `'emails.post_id'` |
| `comment` | inside a comment, JSDoc, or docstring | `// the member's email` |
| `import_specifier` | inside an import or require path or name | `require('../email-suppression-list')` |
| `type_name` | a type or class name used as a type, including when it is the only occurrence on a field or parameter line (`from: EmailAddress;`, `preferred: EmailAddresses,`) | `SignupEmailDto`, `EmailStr`, `EmailAddress` |

Prose strings (rule 3 of status) use `string_literal`. Template placeholders use `identifier`.

`subject.name` is the chosen occurrence's token exactly as written, and it must contain the concept. `PLUGIN_ID = "mirumee.notifications.user_email"`: the occurrence is `user_email` in the string, so `subject.name: user_email`, `string_literal`, not `PLUGIN_ID`.

## Field 3: `mention_attributes.declaration`

Record it only in these cases. Otherwise leave the field out.

1. **Identifier.** A bare name (`email`, `userEmail`): the line where that name is declared in this file (`const`, `let`, `var`, function parameter, Python assignment or parameter, class field). If it is imported from a relative module (`./` or `../`), the line of the matching export in that module. If it comes from a package import or cannot be found, write `unresolved`.
2. **Member access.** `x.email`, `x.get('email')`, `x['email']`, `x.from.address`: the declaration of the base `x` under rule 1, with the base's kind. A parameter stays kind `parameter` at every use, including destructured parameters (`async cycleTransientId({ id, email })`). For `this.x`, `this.#x`, or `self.x`: the line in this file's class that declares the field `x` (a class field declaration, a TypeScript field type, or the first `this.x =` / `self.x =` in the constructor), kind `field`; `unresolved` if there is none.
3. **Object or dict key, or keyword argument, that holds the address** (`requestUserEmail: frame.user.get('email')`, `"recipient_email": user.email`): this line itself, kind `field`.
   A function parameter that holds the address (`def retrieve_user_by_email(email):`): this line itself, kind `parameter`.
4. **Field definition** (`email = models.EmailField()`, a schema column): this line itself, kind `field`.

Every positive line whose syntax_kind is `identifier` or `property_key` must have a declaration, even if it is `unresolved`. Never record a declaration for comments, imports, string literals, or negative lines. The validator enforces both.

`kind` is one of: `local` (`const`, `let`, `var`, or a Python local assignment), `parameter`, `field` (class field, model field, object key), `function`, `class`, `export`.

```yaml
declaration:
  file_path: ghost/core/core/server/api/endpoints/members.js
  line: 503
  kind: local
```

## Field 4: `mention_attributes.type_annotation`

Whenever the declaration line has a written type for that name, write it as written: TypeScript `payload: SignupDto` → `SignupDto`, `validate(email: string, ...)` → `string`, `#getFallbackEmail: () => EmailAddress | null` → `() => EmailAddress | null`; Python `email: str` → `str`. Record it on every positive line that points to that declaration. Never infer a type. JavaScript usually has none; JSDoc `@param {string}` does not count.

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
| TS `#isValidEmailAddress: (email: string) => boolean;` (class field holding a validator function) | negative | identifier | none |
| TS `if (!this.#isValidEmailAddress(preferred.from.address)) {` (`preferred` is a parameter on line 105) | positive | identifier | line 105, `parameter` |
| TS `` logging.error(`Invalid replyTo address: ${preferred.replyTo.address}`); `` | positive | string_literal | none |
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
- Record the pass in the repository-root `annotations/<your-issue-id>/pass.md` (the top-level `annotations/` directory with the other `KDATAP-*` folders, not under `tests/benchmark/`): files, record count, how many positive, negative, and ambiguous, and anything you were unsure about.
