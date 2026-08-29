# Ground-truth schema for fixture and corpus evaluation

Six evaluation grades span the personal-data pipeline and the component graph. Subject keys are stable identities used in both Jest fixture eval (`tests/eval/layers/`) and benchmark corpus annotations (`tests/benchmark/`).

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

## Corpus compatibility

Benchmark manifests and annotation YAML use snake_case layer names (`raw_hits`, `data_items`, `data_flows`). The deprecated `pii_signals` corpus layer is normalized to `mentions` on load; annotation files may live at `annotations/mentions.yaml` or the legacy `annotations/pii_signals.yaml`.
