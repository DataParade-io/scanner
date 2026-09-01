# Canonical evaluation representation

Behaviour specification for the versioned canonical representation emitted by both gold and scanner adapters (KDATAP-b18135). Executable scenarios live in `features/canonical-evaluation-representation.feature`. TypeScript IR types are implemented in KDATAP-06634c.

**Rulings absorbed:** KDATAP-95cfe1 (legacy `subject.name`), KDATAP-00e64a (instance/vendor), KDATAP-471fdc (component entity identity and cardinality), KDATAP-32c089 (flow disposition), KDATAP-4d9b30 (capability coverage diagnostic).

**Prohibition (all layers):** candidates, labels, and display names never rescue identity.

The current `${type}:${name}` subject keys in `ground-truth-schema.md` are **legacy**. This document defines the canonical contract that replaces overloaded key strings and the `EvalCase` / `LayerFinding` pair as scoring currency.

Headline layers: `mentions`, `data-items`, `components`, and `data-flows`. The `raw-hits` layer is diagnostic only and does not participate in headline gates.

---

## Contract envelope

Every canonical expectation and finding carries:

| Field | Role |
| --- | --- |
| `contractVersion` | Evaluation-contract semantics. Changes when canonicalization-map meaning changes (semantic remap). |
| `adapterMapVersion` | Scanner capability manifest digest for the exact scanner commit, enabled rules, analyzers, and runtime configuration. |

Gold and scanner findings for the same evidence must carry the same `contractVersion` after adapter normalization. The canonicalization map (what observations mean) and the capability manifest (what the scanner can emit) are **separate versioned artifacts** — do not use one mutable table for both.

---

## Core field groups

Fields are grouped by matching role. Asserted fields participate in strict correctness. Descriptive and candidate fields do not. Diagnostic fields never alter recall denominators.

### Identity

| Field | Asserted | Notes |
| --- | --- | --- |
| Repo-local entity identity | Yes | Layer-appropriate identity for one-to-one assignment. |
| `entityId` (gold components only) | Bookkeeping | Stable repository-local gold entity id. Migration bookkeeping only — the scanner **never** emits it. |

### Classification

| Field | Asserted | Notes |
| --- | --- | --- |
| Concept leaf | Yes | Asserted semantic concept at the finest reviewed granularity. |
| Concept ancestry | Yes | Taxonomy path from root to leaf. |
| Component `type` | Yes (components) | Infrastructure class. |
| Component `subtype` | Yes (components) | Taxonomy subtype within the type. |

### Optional assertion

| Field | Asserted when present | Notes |
| --- | --- | --- |
| Vendor / instance | Only when reviewed gold asserts it | Legacy third-party `subject.name` is an asserted vendor. Asset and actor legacy names are **not** automatically asserted instances. Optional instance is permitted on any component type when reviewed. |

Strict success means every field **reviewed gold explicitly asserts**, not every field the schema defines.

### Evidence

| Field | Role |
| --- | --- |
| `evidenceLocations[]` | File/line spans anchoring the observation. |
| `derivationLocations[]` | Locations from which the observation was derived. |

Evidence supports span overlap, repository-entity consolidation, and separate evidence-location coverage reporting.

### Observed tokens

| Field | Role |
| --- | --- |
| `observedTokenCandidates[]` | Each entry: `value`, evidence reference, provenance, validation state (`verified`, `unverified`, `contradicted`). |

Never promoted to canonical identity automatically. Never used to rescue a canonical key mismatch.

### Display

| Field | Role |
| --- | --- |
| `displayText` | Human-readable text isolated from matching. |

### Diagnostics

| Field | Role |
| --- | --- |
| `declaredCapabilitySupported` | Per accepted canonical evaluable positive: whether the capability manifest declares detector support, with reason. |
| `declaredCapabilityCoverage` | Case-weighted and distinct-leaf coverage aggregates. Diagnostic only. |
| `needs_adjudication` | Disposition for unresolved migration or ambiguous grouping. |

---

## Per-layer legacy `subject.name` treatment (KDATAP-95cfe1)

| Layer | Legacy `subject.name` becomes | Must not |
| --- | --- | --- |
| Mentions | Evidence-linked observed source token on that exact occurrence | Promote to authoritative source identity or concept |
| Data items | Collection of observed tokens per evidence location; consolidation preserves all spellings | Collapse to one arbitrary value; discard contradictory values |
| Assets / actors | Observed code or display evidence | Required canonical instance |
| Third parties | Vendor candidate cross-checked against asserted vendor | Auto-copy into canonical vendor; mismatch without adjudication |
| Data flows | Legacy display and migration provenance only | Endpoint or semantic matching field |

Contradictory observed tokens (for example `email_address` paired with `clientID`) are retained and routed to adjudication.

---

## Component entity model (KDATAP-00e64a, KDATAP-471fdc)

### Strict matching

- Match on asserted `type`, `subtype`, optional vendor/instance (when asserted), concept fields, and evidence.
- Unasserted schema fields are not required.
- Vendor-resolution metrics use a **separate denominator** over records that assert a vendor; subtype-only records do not dilute vendor metrics.
- Optional instance must **never** be invented to distinguish or manufacture same-subtype entity cardinality.

### Repository-entity consolidation

Annotation rows are supporting observations, not automatically separate components.

1. **Consolidate** repository graph entities before one-to-one assignment.
2. Group rows only when reviewed evidence establishes the same graph node.
3. Preserve genuinely distinct same-subtype entities.
4. Leave ambiguous grouping in `needs_adjudication` — no arbitrary first-evidence grouping.
5. Never collapse every row sharing a subtype.

### Scoring

| Metric | Rule |
| --- | --- |
| Entity recall | Scored once per consolidated repository entity. |
| Evidence-location coverage | Reported separately. A missed second evidence location must not create a second entity false negative. |

### Subtype graph boundaries

| Subtype | Boundary |
| --- | --- |
| `database` | Backing store or connection, not each ORM model declaration. |
| `api` | Exposed API surface or deployable section. |
| `actor` | Role entity, not each code declaration. |

Assignment prefers exact asserted fields and evidence overlap. The evaluator **never guesses** between indistinguishable same-subtype entities.

---

## Flow disposition (KDATAP-32c089)

At migration start, every legacy accepted flow row moves to `needs_adjudication`. No compatibility alias keeps it accepted.

Triage each row into:

1. Candidate canonical component or data-entity graph edge (human-reviewed into headline flow layer).
2. Future intra-component lineage or transformation evidence (preserved with provenance).
3. Unsupported, incorrect, or unsubstantiated annotation (rejected with rationale).

Legacy flow keys and prose `subject.name` values are display forms, not scorer identity. Matching uses asserted canonical endpoints only.

Baseline series 1 uses an approved canonical graph-flow subset declared upfront (minimum case count, packet diversity, language diversity, flow-type coverage). The subset is not chosen after inspecting scanner results. All 436 legacy rows remain visible in migration accounting.

---

## Capability coverage (KDATAP-4d9b30)

| Rule | Detail |
| --- | --- |
| Raw recall denominator | Always every accepted canonical evaluable positive. |
| Valid unsupported concept | Strict false negative; `declaredCapabilitySupported` is false with reason. |
| Capability coverage | Case-weighted (supported ÷ all accepted) and distinct-leaf (supported leaves ÷ distinct leaves in gold). Diagnostic only. |
| Suppression | Capability coverage never suppresses a miss, changes a gate denominator, or creates a new baseline series. |
| Source-token-only records | `needs_adjudication` or rejected until they carry a reviewed canonical concept. Reported in migration readiness, not as baseline false negatives. |

---

## Concept correctness

| Layer | Rule |
| --- | --- |
| Exact-leaf | Credited only when the finding's asserted concept leaf matches the expectation's asserted leaf. |
| Ancestor-category | Reported separately. An ancestor match (for example `national_identifier` when the leaf is `driver_licence`) does not credit exact-leaf correctness. |

---

## Adapter contract

Both gold and scanner adapters produce the same canonical representation shape:

- Entity identity, asserted classification, optional vendor/instance, and evidence are **separate fields**.
- After adapter normalization, gold expectations and scanner findings for the same evidence share `contractVersion`.
- Implementation: KDATAP-06634c (types), adapters epic (gold/scanner bridges).
