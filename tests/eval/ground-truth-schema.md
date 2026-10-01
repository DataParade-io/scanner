# Ground-truth schema for fixture and corpus evaluation

Schema version: `ground-truth/3`. Version 3 renames "mention" to **occurrence** throughout (KDATAP-3f9029): the layer is `occurrences`, subject keys are `occurrence:<concept>`, gold lives in `annotations/occurrences.yaml`, and attributes are `occurrence_attributes`. An occurrence is one place where a data item appears in code, with its location and role, following the term used by Sourcegraph's SCIP code-intelligence format. Readers still accept the version 2 names (`mentions`, `mention:`, `mention_attributes`) and the older layer name. Version 2 added optional attributes on occurrence gold and agent labeling packets (KDATAP-8b2c8a); version 1 records remain valid.

Four **headline layers** (`occurrences`, `data-items`, `components`, `data-flows`) form the evaluation vector. Jest also runs **diagnostic** layers — `raw-hits` and `data-actions` — that are scanned and reported but excluded from headline gates and the `scorecard-vector/3` vector. There is **no cross-layer scalar**: metrics pool within each layer only.

Subject keys are stable identities used in Jest fixture eval (`tests/eval/layers/`) and benchmark corpus annotations (`tests/benchmark/`).

**Canonical representation:** The subject-key formats below are the **legacy** scoring currency. The versioned canonical evaluation representation — separate identity, classification, evidence, observed-token candidates, and display fields — is specified in [`canonical-representation.md`](./canonical-representation.md) with executable scenarios in `features/canonical-evaluation-representation.feature`.

## Headline layers

| Layer | Jest key | Corpus layer | What it measures |
| --- | --- | --- | --- |
| Occurrences | `occurrences` | `occurrences` | File+line receipt that a personal-data concept was seen |
| Data items | `data-items` | `data_items` | Unique personal-data concept in a fixture (rolled up across hits) |
| Components | `components` | `components` | Detected infrastructure and third-party assets |
| Data flows | `data-flows` | `data_flows` | Directed edges between components |

Personal-data headline layers share heuristic rules (`patterns/pii-signals.rules.yaml`) but differ in roll-up and matching semantics. Graph layers use the deterministic `scan()` pipeline.

## Diagnostic layers

| Layer | Jest key | Corpus layer | Role |
| --- | --- | --- | --- |
| Raw hits | `raw-hits` | `raw_hits` | YAML heuristic pattern match before roll-up (one finding per line hit). Fixture eval and scorecard sidecar (`diagnostic.raw-hits`) only — not a headline gate. |
| Data actions | `data-actions` | `data_actions` | Privacy verbs on component nodes (`properties.dataActions`). Fixture eval diagnostic only — **not** a `scorecard-vector/3` headline gate; not in the `diagnostic.raw-hits` sidecar. |

## Identity rules

### Personal data

| Layer | Subject key format | Example |
| --- | --- | --- |
| Occurrence | `occurrence:<key>` | `occurrence:email` |
| Data item | `data_item:<key>` | `data_item:email` |
| Raw hit (diagnostic) | `raw_hit:<key>` | `raw_hit:email` |

Occurrence keys use `occurrence:<rule_id>` when aligned to a reviewed rule from `patterns/pii-signals.rules.yaml`, or `occurrence:<taxonomy_suffix>` for adjudication bookmarks. The concept leaf asserted in canonical gold may differ from the rule id; see [`canonical-representation.md`](./canonical-representation.md).

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
| Occurrences | Subject key **and** evidence span overlap **and** expected labels |
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

## Occurrence attributes

Occurrence gold may assert structural attributes of the matched line in an optional `occurrence_attributes` block. The block is accepted only on the `occurrences` layer, and unknown keys are rejected. A record asserts only the attributes it labels. Each attribute is scored as its own metric over matched gold that asserts it, following the vendor pattern; unasserted attributes never count against a finding.

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
occurrence_attributes:
  syntax_kind: identifier
  declaration: {file_path: src/signup.js, line: 2, kind: parameter}
  owner: api
  touches: [third_party:mailer]
  group: signup-email
```

## Attribute and grouping metrics

The occurrences layer reports two extra blocks next to its headline metrics (KDATAP-ec05ea). Neither changes a headline denominator, and there is no cross-metric scalar.

- `occurrenceAttributes`: for each of `syntax_kind`, `declaration`, `type_annotation`, `owner`, and `touches`, accuracy over matched positive pairs whose gold asserts that attribute. `declaration` matches on file, line, and kind, or on `unresolved`; `touches` compares as a set.
- `grouping`: pairwise precision and recall over matched positive occurrences whose gold asserts `group`. Recall is the share of gold same-group pairs the scanner also puts together; precision is the share of scanner same-group pairs that gold also puts together. A occurrence without a predicted group is its own singleton.

Each score carries a state:

| State | Meaning |
| --- | --- |
| `computable` | The value is defined over the stated denominator |
| `not_asserted_by_gold` | No matched gold asserts the attribute |
| `scanner_capability_not_declared` | No scanner occurrence finding carries the attribute; the denominator counts the gold that would be scored |

Packet scores merge by summing numerators and denominators of computable packets.

## Labeling packets

Agents write proposed occurrence gold to a packet, never directly to `annotations/occurrences.yaml`. One packet covers one labeling batch at `repos/<repo>/annotations/packets/<kanbus-issue-id>.yaml`:

```yaml
packet:
  repo: ghost
  concept: email
  kanbus_issue: KDATAP-xxxxxx
  files: [repo/relative/path.js]
annotations:
  - ... # occurrence records, review_state: proposed
```

`pnpm run benchmark:validate-packet <packet.yaml>` checks a packet and reports every problem at once. It requires the repo to be materialized at its pinned commit and `annotations/packets/<concept>-candidates.yaml` to exist. It rejects unknown fields, records that are not `occurrences` or not `proposed`, duplicate ids, evidence or declaration lines that do not exist at the pinned commit, evidence outside `packet.files`, and any candidate line in `packet.files` without exactly one record. A record on a line the candidate inventory missed is kept with a warning. Accepted packets are merged into `annotations/occurrences.yaml`.

## Corpus layout

Benchmark manifests and annotation YAML use snake_case layer names (`occurrences`, `data_items`, `components`, `data_flows`). Occurrence annotations live at `annotations/occurrences.yaml` with `occurrence:<rule_id>` subject keys.

## Precision via exhaustive file scopes

Reviewed closed-world scope lives in `tests/benchmark/repos/<key>/layer-scopes.yaml`, keyed by canonical corpus layer. Only entries with `provenance.review_state: accepted` enter the precision denominator. `evaluateCanonical` (via `scoreEvalCases`) treats those files as a closed world per fixture×layer bucket: every scanner finding with source locations in them is a precision denominator item, and it is a true positive only if it is assigned to an accepted positive gold case on that layer. A repo that does not use a vendor needs no negative case; extra hits lower precision automatically. Locationless findings are excluded from the denominator. Eval conversion may attach scope onto cases in memory via `to-eval-cases.ts`; scope is never copied back onto annotation YAML.

## Concept-scoped exhaustive scopes

A layer-wide exhaustive scope is closed-world for every concept in its files. When gold has been labeled for one concept only, declare a concept scope instead, under `concept_scopes` in `layer-scopes.yaml` (KDATAP-ec05ea):

```yaml
concept_scopes:
  occurrences:
    - subject_keys: [occurrence:email]
      exhaustive_scope_files: [ghost/core/core/server/models/member.js]
      provenance: {proposed_by: ..., proposed_at: ..., review_state: accepted}
```

A scanner finding enters the precision denominator when it has a location in a layer-wide scope file, or when its subject key is listed and it has a location in that concept scope's files. Findings for other concepts in a concept-scoped file are ignored. Concept scope files count toward reviewed and processed scope files. Layer-wide scopes use only `accepted` records; concept scopes follow the run's review states, so a provisional run that includes `proposed` gold also uses proposed concept scopes.

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

Recall and precision use separate states and denominators. See `scorecard-vector/3` in `tests/benchmark/README.md`.

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

Published baselines use `baseline-artifact/1`. The embedded `readiness` block reports `not_evaluated`, `pass`, or `fail` with blockers and `invariantVersions` (including `ground-truth/3` and `eligibility-reasons/1`). Numeric readiness floors are a separate epic.

## Known limitations (deferred)

- **Raw hits vs occurrences are isomorphic today** — both layers run the same YAML heuristic matcher (`matchPiiSignalsInFiles`); they differ only in subject-key prefix until a distinct roll-up stage exists for occurrences.
- **Negative cases are vacuous on current patterns** — the heuristic rule set has no negative fixtures that exercise false-positive rejection; expanding negative coverage is a heuristic flywheel item, not a schema change.
