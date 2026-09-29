# Ground-truth schema for fixture and corpus evaluation

Schema version: `ground-truth/2`. Version 2 adds optional `mention_attributes` on mention gold and agent labeling packets (KDATAP-8b2c8a); version 1 records remain valid.

Four **headline layers** (`mentions`, `data-items`, `components`, `data-flows`) form the evaluation vector. Jest also runs **diagnostic** layers — `raw-hits` and `data-actions` — that are scanned and reported but excluded from headline gates and the `scorecard-vector/2` vector. There is **no cross-layer scalar**: metrics pool within each layer only.

Subject keys are stable identities used in Jest fixture eval (`tests/eval/layers/`) and benchmark corpus annotations (`tests/benchmark/`).

**Canonical representation:** The subject-key formats below are the **legacy** scoring currency. The versioned canonical evaluation representation — separate identity, classification, evidence, observed-token candidates, and display fields — is specified in [`canonical-representation.md`](./canonical-representation.md) with executable scenarios in `features/canonical-evaluation-representation.feature`.

## Headline layers

| Layer | Jest key | Corpus layer | What it measures |
| --- | --- | --- | --- |
| Mentions | `mentions` | `mentions` | File+line receipt that a personal-data concept was seen |
| Data items | `data-items` | `data_items` | Unique personal-data concept in a fixture (rolled up across hits) |
| Components | `components` | `components` | Detected infrastructure and third-party assets |
| Data flows | `data-flows` | `data_flows` | Directed edges between components |

Personal-data headline layers share heuristic rules (`patterns/pii-signals.rules.yaml`) but differ in roll-up and matching semantics. Graph layers use the deterministic `scan()` pipeline.

## Diagnostic layers

| Layer | Jest key | Corpus layer | Role |
| --- | --- | --- | --- |
| Raw hits | `raw-hits` | `raw_hits` | YAML heuristic pattern match before roll-up (one finding per line hit). Fixture eval and scorecard sidecar (`diagnostic.raw-hits`) only — not a headline gate. |
| Data actions | `data-actions` | `data_actions` | Privacy verbs on component nodes (`properties.dataActions`). Fixture eval diagnostic only — **not** a `scorecard-vector/2` headline gate; not in the `diagnostic.raw-hits` sidecar. |

## Identity rules

### Personal data

| Layer | Subject key format | Example |
| --- | --- | --- |
| Mention | `mention:<key>` | `mention:email` |
| Data item | `data_item:<key>` | `data_item:email` |
| Raw hit (diagnostic) | `raw_hit:<key>` | `raw_hit:email` |

Mention keys use `mention:<rule_id>` when aligned to a reviewed rule from `patterns/pii-signals.rules.yaml`, or `mention:<taxonomy_suffix>` for adjudication bookmarks. The concept leaf asserted in canonical gold may differ from the rule id; see [`canonical-representation.md`](./canonical-representation.md).

### Graph

| Layer | Subject key format | Example |
| --- | --- | --- |
| Component | `${type}:${name}` (lowercase name) | `third_party:stripe` |
| Data flow | `flow:${sourceKey}->${targetKey}` | `flow:asset:api->third_party:stripe` |
| Data action (diagnostic) | `${type}:${name}` (same as component; labels = asserted verbs) | `asset:pg` with label `store` |

Accepted component annotations may also carry an optional **`canonical`** block (KDATAP-8aed54) with structured `entity_id`, `identity_key`, `component_type`, `component_subtype`, and optional `vendor`. Legacy `subject.key` / `subject.name` remain as provenance; classification identity is `${type}:${subtype}`.

Accepted data-flow annotations may carry an optional **`flow_canonical`** block (KDATAP-7e5b94) with structured `identity_key`, `disposition_candidate`, `source_entity_id`, `target_entity_id`, typed `endpoints`, and optional `flow_type` / `data_categories`. Legacy `subject.key` / `subject.name` remain as display provenance; scorer identity and endpoints come from `flow_canonical` only. Non-scoring `candidate` blocks from migration/adjudication may remain for audit.

## Matching semantics

Scoring lives in `tests/eval/score.ts`. Headline metrics are computed per layer; no cross-layer scalar is published.

| Layer | Match rule |
| --- | --- |
| Mentions | Subject key **and** evidence span overlap **and** expected labels |
| Data items | Subject key **only** (identity match; evidence file anchors unread detection) |
| Components | Subject key **and** evidence span overlap **and** expected labels |
| Data flows | Subject key **and** evidence span overlap **and** expected labels |
| Raw hits (diagnostic) | Subject key **and** evidence span overlap **and** expected labels |
| Data actions (diagnostic) | Subject key **and** evidence span overlap **and** expected verb label among asserted `dataActions` |

## Case status

Each ground-truth case carries an `expected.status`:

- `positive` — scanner should emit a matching finding
- `negative` — scanner must not emit a matching finding at the evidence span (or identity for data items)
- `ambiguous` — excluded from pass/fail gates

Positives may set `documentedGap: true` for known scanner misses. They remain in recall denominators for reporting; CI gates exclude them when asserting pass/fail.

**Precision** is not computed from negatives. Mark files as `exhaustiveScopeFiles` on gold cases. Then every scanner finding in those files is a precision denominator item; it is a true positive only if it matches some accepted positive gold case. A repository that does not use Stripe is not recorded as a negative. If the scanner emits Stripe there anyway, that unmatched finding lowers precision.

## Mention attributes

Mention gold may assert structural attributes of the matched line in an optional `mention_attributes` block. The block is accepted only on the `mentions` layer, and unknown keys are rejected. A record asserts only the attributes it labels. Each attribute is scored as its own metric over matched gold that asserts it, following the vendor pattern; unasserted attributes never count against a finding.

| Field | Value |
| --- | --- |
| `syntax_kind` | `identifier`, `property_key`, `string_literal`, `import_specifier`, `comment`, or `type_name` |
| `declaration` | `{file_path, line, kind}` with kind `local`, `parameter`, `field`, `function`, `class`, or `export`; or the string `unresolved` when the declaration is outside the repo or more than one relative-import hop away |
| `type_annotation` | Written type name on that declaration, when one is written. Never inferred. |
| `owner` | Repo-local name of the code unit that owns the file |
| `touches` | Component identity keys the line touches |
| `group` | Repo-local declaration-group id for the grouping layer |

`expected.status` keeps its meaning. For a concept such as email, `positive` means the line handles a value of the concept, and `negative` means the match is only the word (an import specifier, a connection or template name, prose, a config key).

```yaml
mention_attributes:
  syntax_kind: identifier
  declaration: {file_path: src/signup.js, line: 2, kind: parameter}
  owner: api
  touches: [third_party:mailer]
  group: signup-email
```

## Labeling packets

Agents write proposed mention gold to a packet, never directly to `annotations/mentions.yaml`. One packet covers one labeling batch at `repos/<repo>/annotations/packets/<kanbus-issue-id>.yaml`:

```yaml
packet:
  repo: ghost
  concept: email
  kanbus_issue: KDATAP-xxxxxx
  files: [repo/relative/path.js]
annotations:
  - ... # mention records, review_state: proposed
```

`pnpm run benchmark:validate-packet <packet.yaml>` checks a packet and reports every problem at once. It requires the repo to be materialized at its pinned commit and `annotations/packets/<concept>-candidates.yaml` to exist. It rejects unknown fields, records that are not `mentions` or not `proposed`, duplicate ids, evidence or declaration lines that do not exist at the pinned commit, evidence outside `packet.files`, and any candidate line in `packet.files` without exactly one record. A record on a line the candidate inventory missed is kept with a warning. Accepted packets are merged into `annotations/mentions.yaml`.

## Corpus layout

Benchmark manifests and annotation YAML use snake_case layer names (`mentions`, `data_items`, `components`, `data_flows`). Mention annotations live at `annotations/mentions.yaml` with `mention:<rule_id>` subject keys.

## Precision via exhaustive file scopes

Reviewed closed-world scope lives in `tests/benchmark/repos/<key>/layer-scopes.yaml`, keyed by canonical corpus layer. Only entries with `provenance.review_state: accepted` enter the precision denominator. `evaluateCanonical` (via `scoreEvalCases`) treats those files as a closed world per fixture×layer bucket: every scanner finding with source locations in them is a precision denominator item, and it is a true positive only if it is assigned to an accepted positive gold case on that layer. A repo that does not use a vendor needs no negative case; extra hits lower precision automatically. Locationless findings are excluded from the denominator. Eval conversion may attach scope onto cases in memory via `to-eval-cases.ts`; scope is never copied back onto annotation YAML.

## Metric computability

Precision and recall null rates carry an explicit per-metric **computability state**. States retain reviewed/processed file counts and prediction denominators even when the numeric rate is null.

| State | Meaning |
| --- | --- |
| `no_reviewed_scope` | No accepted closed-world files for precision |
| `reviewed_scope_unprocessed` | Scope declared but not successfully processed on the layer ledger |
| `processed_scope_zero_predictions` | Processed scope with zero in-scope predictions |
| `migration_incomplete_or_not_ready` | Layer gold or compat migration not ready for headline scoring |
| `unscorable_provenance` | Only locationless or otherwise unscoreable findings |
| `computable` | Metric has a valid denominator |

Recall and precision use separate states and denominators. See `scorecard-vector/2` in `tests/benchmark/README.md`.

## Eligibility reasons

Path eligibility uses a locked set of eleven reasons (`eligibility-reasons/1`), mirrored in `src/ingest/eligibility.ts`:

| Reason | Stage |
| --- | --- |
| `successfully_processed` | ingest / layer |
| `unsupported_file_type_or_language` | ingest |
| `excluded_by_configured_policy` | ingest |
| `ignored_by_repository_default_policy` | ingest |
| `sensitive_path_exclusion` | ingest |
| `file_too_large` | ingest |
| `file_count_cap_reached` | ingest |
| `total_byte_cap_reached` | ingest |
| `missing_or_path_contract_mismatch` | layer |
| `read_decode_error` | ingest |
| `parse_or_layer_processing_error` | layer |

## Capability diagnostics

`declaredCapabilitySupported` and `declaredCapabilityCoverage` are **diagnostic only** (`diagnostic_only_not_recall_denominator`). They never suppress a miss, change a gate denominator, or create a cross-layer scalar.

## Baseline readiness

Published baselines use `baseline-artifact/1`. The embedded `readiness` block reports `not_evaluated`, `pass`, or `fail` with blockers and `invariantVersions` (including `ground-truth/2` and `eligibility-reasons/1`). Numeric readiness floors are a separate epic.

## Known limitations (deferred)

- **Raw hits vs mentions are isomorphic today** — both layers run the same YAML heuristic matcher (`matchPiiSignalsInFiles`); they differ only in subject-key prefix until a distinct roll-up stage exists for mentions.
- **Negative cases are vacuous on current patterns** — the heuristic rule set has no negative fixtures that exercise false-positive rejection; expanding negative coverage is a heuristic flywheel item, not a schema change.
