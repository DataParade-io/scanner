# Ground-truth schema for fixture and corpus evaluation

Five evaluation grades span the personal-data pipeline (three grades) and the component graph (two grades). Subject keys are stable identities used in both Jest fixture eval (`tests/eval/layers/`) and benchmark corpus annotations (`tests/benchmark/`).

**Canonical representation:** The subject-key formats below are the **legacy** scoring currency. The versioned canonical evaluation representation — separate identity, classification, evidence, observed-token candidates, and display fields — is specified in [`canonical-representation.md`](./canonical-representation.md) with executable scenarios in `features/canonical-evaluation-representation.feature`. TypeScript IR types follow in KDATAP-06634c.

## Evaluation grades

| Grade | Jest layer | Corpus layer | What it measures |
| --- | --- | --- | --- |
| Raw hits | `raw-hits` | `raw_hits` | YAML heuristic pattern match before roll-up (one finding per line hit) |
| Mentions | `mentions` | `mentions` | File+line receipt that a personal-data concept was seen |
| Data items | `data-items` | `data_items` | Unique personal-data concept in a fixture (rolled up across hits) |
| Components | `components` | `components` | Detected infrastructure and third-party assets |
| Data flows | `data-flows` | `data_flows` | Directed edges between components |

The three personal-data grades share the same underlying heuristic rules (`patterns/pii-signals.rules.yaml`) but differ in identity and matching semantics.

## Identity rules

### Personal data

| Grade | Subject key format | Example |
| --- | --- | --- |
| Raw hit | `raw_hit:${ruleId}` | `raw_hit:email` |
| Mention | `mention:${conceptId}` | `mention:email` |
| Data item | `data_item:${conceptId}` | `data_item:email` |

`conceptId` equals the rule id from `patterns/pii-signals.rules.yaml` (one rule maps to one data-item concept).

### Graph

| Grade | Subject key format | Example |
| --- | --- | --- |
| Component | `${type}:${name}` (lowercase name) | `third_party:stripe` |

Accepted component annotations may also carry an optional **`canonical`** block (KDATAP-8aed54) with structured `entity_id`, `identity_key`, `component_type`, `component_subtype`, and optional `vendor`. Legacy `subject.key` / `subject.name` remain as provenance; classification identity is `${type}:${subtype}`.
| Data flow | `flow:${sourceKey}->${targetKey}` | `flow:asset:api->third_party:stripe` |

## Matching semantics

Scoring lives in `tests/eval/score.ts`.

| Grade | Match rule |
| --- | --- |
| Raw hits | Subject key **and** evidence span overlap **and** expected labels |
| Mentions | Subject key **and** evidence span overlap **and** expected labels |
| Data items | Subject key **only** (identity match; evidence file anchors unread detection) |
| Components | Subject key **and** evidence span overlap **and** expected labels |
| Data flows | Subject key **and** evidence span overlap **and** expected labels |

## Case status

Each ground-truth case carries an `expected.status`:

- `positive` — scanner should emit a matching finding
- `negative` — scanner must not emit a matching finding at the evidence span (or identity for data items)
- `ambiguous` — excluded from pass/fail gates

Positives may set `documentedGap: true` for known scanner misses. They remain in recall denominators for reporting; CI gates exclude them when asserting pass/fail.

**Precision** is not computed from negatives. Mark files as `exhaustiveScopeFiles` on gold cases. Then every scanner finding in those files is a precision denominator item; it is a true positive only if it matches some accepted positive gold case. A repository that does not use Stripe is not recorded as a negative. If the scanner emits Stripe there anyway, that unmatched finding lowers precision.

## Corpus compatibility

## Corpus compatibility

Benchmark manifests and annotation YAML use snake_case layer names (`raw_hits`, `data_items`, `data_flows`). The deprecated `pii_signals` corpus layer is normalized to `mentions` on load; annotation files may live at `annotations/mentions.yaml` or the legacy `annotations/pii_signals.yaml`.

Subject keys are normalized on load via `normalizeSubjectKey` in `tests/benchmark/manifest.ts`. Legacy `pii_signal:` prefixes migrate to `mention:` (mentions layer) or `raw_hit:` (raw_hits layer). Stale `pii_signal:` keys that survive migration are rejected.

## Precision via exhaustive file scopes

Reviewed closed-world scope lives in `tests/benchmark/repos/<key>/layer-scopes.yaml`, keyed by canonical corpus layer. Only entries with `provenance.review_state: accepted` enter the precision denominator. `tests/benchmark/precision.ts` treats those files as a closed world per layer: every scanner finding in them is a precision denominator item, and it is a true positive only if it matches a positive annotation on that layer. A repo that does not use a vendor needs no negative case; extra hits lower precision automatically. Locationless findings (no source paths) are included in the denominator. Eval conversion may attach scope onto cases in memory via `to-eval-cases.ts`; scope is never copied back onto annotation YAML.

## Known limitations (deferred)

- **Raw hits vs mentions are isomorphic today** — both grades run the same YAML heuristic matcher (`matchPiiSignalsInFiles`); they differ only in subject-key prefix until a distinct roll-up stage exists for mentions.
- **Negative cases are vacuous on current patterns** — the heuristic rule set has no negative fixtures that exercise false-positive rejection; expanding negative coverage is a heuristic flywheel item, not a schema change.
