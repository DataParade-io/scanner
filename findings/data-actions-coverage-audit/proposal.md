# Data-actions corpus coverage audit (Task 5.1)

**Date:** 2026-09-07  
**Layer:** `data_actions` (diagnostic; not a `scorecard-vector/2` headline)  
**Method:** Source- and annotation-driven review of pinned packets under `tests/benchmark/repos/`. Existing accepted component/data-flow gold was used only as an inventory of declared subjects — not as verb labels. No `scan()` output was copied into recommendations.  
**Skill:** `.agents/skills/curate-scanner-evaluation-corpus/` (Select repositories)  
**PRD verbs:** `collect`, `generate`, `store`, `transform`, `use`, `combine`, `disclose`, `relay`, `display`, `log`, `delete`

---

## Goal for Phase 5

Exit criteria (tasks doc): **≥50 accepted `data_actions` annotations across ≥3 repos**, with coverage target ≥3 positives per canonical verb where gold claims that verb, ≥3 multi-verb nodes, and relay never gold-positive without corroboration.

This audit selects which existing packets to annotate in **5.2** and which scope expansions 5.2 must propose before gold lands.

---

## Coverage gaps (corpus vs fixture eval)

Fixture eval (`tests/eval/layers/data-actions/`) already exercises many verbs. The **corpus** must add real-repo depth, especially:

| Verb | Corpus outlook from this audit |
| ---- | ------------------------------ |
| `store` | Abundant (ORM/JPA models, vault types) |
| `disclose` | Strong in ghost (Stripe), vgs-django (Checkr), auth0-express, medusa vendors |
| `collect` | Present but often **outside** current component exhaustive scopes (forms/controllers) |
| `transform` | Sparse but clear: hyperswitch encryptables, posthog `anonymize_data`, auth0 session encrypt, Magento password hash upgrade |
| `delete` | Sparse: TTL on vault cards, session destroy, admin delete toggles — need careful positive selection |
| `display` | Sparse: vgs `get_data` / detail templates; petclinic GET owners |
| `log` | **Weak in current scopes** — Ghost payments-service has `logging.error`/`warn` but not clearly PII-gated on the same line; prefer fixture-backed `log` until a compact PII+logger span is scoped |
| `relay` | vgs outbound proxy is the best **candidate** story; do not assert without corroboration metadata |
| `use` / `generate` / `combine` | Thin in pinned scopes; do not force — pad via fixtures or defer with explicit gap notes in 5.2 |

---

## Recommended primary set (annotate in 5.2)

Prefer packets that already have **manageable** accepted component scopes, multi-language breadth, and source-visible verb constructs.

### Tier A — must-include (path to ≥50)

#### 1. `ghost` (javascript) — primary e-commerce / disclose flywheel

- **Pin:** `TryGhost/Ghost@73612b18663c0145dcca8611904b7f21b5f84552`
- **Why:** Accepted component scope already includes member/user models, auth, **and** `ghost/core/core/server/services/stripe/stripe-api.js` + `payments-service.js`. Source shows real Stripe SDK calls (`customers.create`, checkout sessions) and member email persistence.
- **Likely verbs:** `store` (member/user DB), `disclose` (Stripe third party + calling asset), `collect` (member auth/signup controllers), possible `use` on payment orchestration.
- **Multi-verb node:** payment/member service paths that both persist and call Stripe.
- **Accepted component subjects (seed):** 16 positives including `asset:database`, `third_party:stripe`, `actor:customer` (actors stay verb-free per DA-1).
- **Estimate:** ~20–30 asserted verb rows if exhaustive on current component scope files.

#### 2. `spree` (ruby) — primary store + payment-processing depth

- **Pin:** `spree/spree@e6e9823b79177d49e1682e31482a9da5d9139140` (manifest key `spree`)
- **Why:** Compact model/concern scope (`credit_card`, `payment`, `payment_processing`, `customer`, `order`) with gateway processing and many database-backed subjects.
- **Likely verbs:** `store` (multiple models), `disclose`/`use` via payment gateway processing, `collect` on customer/account creation.
- **Accepted component subjects:** 16 positives, heavy `asset:database`.
- **Estimate:** ~20–30 rows.

#### 3. `vgs-django` (python) — starter packet + multi-verb skeleton

- **Pin:** `vgs-samples/vgs-django-sample-id-verification@46acdb3290d677081e1b0889f3b736635a4e0847`
- **Why (tasks doc starter):** Checkr disclose + ORM store + form collect + VGS proxy relay-candidate in one small app.
- **Source evidence (not scanner):**
  - `store` — `app/models.py` `PiiData` CharFields
  - `disclose` — `app/checker_client.py` `requests.post` to Checkr with SSN/DLN
  - `collect` — `app/views.py` `add()` reads `request.POST['SSN']` then `save()`
  - `display` — `get_data` / detail templates return PII JSON/HTML
  - `relay` **candidate only** — `HTTPS_PROXY` outbound via VGS (`turn_on_outbound`); topology/proxy pattern, no asserted gold without corroboration
- **Scope change required for 5.2:** current `layer-scopes.yaml` components scope is only `app/checker_client.py` + `app/models.py`. Add at least `app/views.py` (and optionally templates) before claiming collect/display exhaustively.
- **Estimate after scope expand:** ~6–10 rows (small but high-signal).

Together Tier A targets **≥50** accepted rows with language breadth (JS/Ruby/Python).

### Tier B — compact verb specialty (pad transform/delete/auth)

Use these to hit the ≥3-per-verb floor for pattern-ish verbs without opening huge trees.

| Repo | Languages | Verb focus | Notes |
| ---- | --------- | ---------- | ----- |
| `hyperswitch-vault` | rust | `store`, `transform` (encryptable card payload), `delete`/TTL | Single-file scope `types.rs`; excellent transform/store density |
| `posthog-user` | python | `store`, `transform` (`anonymize_data`), soft `delete` | Single-file `user.py`; anonymize is a clean transform qualifier story |
| `auth0-express` | typescript | `disclose` (Auth0 IdP), `transform` (JWE session), `delete` (session destroy) | Lib scope already reviewed; keep actors verb-free |
| `spring-petclinic` | java | `store`, `collect` (OwnerController POST), cache as `store` | Controllers already in component scope |
| `easy-school` | python | `store` only (starter) | Guardian SSN CharField; **no third-party / weak multi-verb**. Keep as negative-breadth / store regression, not a primary flywheel |
| `keycloak` | java | `store` (User/Credential entities) | Credential secret/salt columns; transform only if hashing call sites are scoped (currently entity-only) |
| `medusa-customer` | typescript | `store` | Model-only; good store positives, no call-site disclose |

### Tier C — defer or use cautiously

| Repo | Reason |
| ---- | ------ |
| `medusa` (modules re-exports) | Scope files are mostly `discoveryPath` stubs (`payment-stripe.ts` re-exports). Vendor subjects exist in gold, but **call-site disclose evidence is thin** vs ghost’s Stripe SDK. Prefer ghost for disclose gold. |
| `discourse` | Extremely large accepted component count (~156). Unsuitable as first exhaustive `data_actions` closed world. |
| `wordpress` / `magento` / `nopcommerce` | Huge include trees; component scopes are large. Revisit after Tier A/B land. |
| `saleor` | Single account model file — store-only; redundant with easy-school/medusa-customer. |
| ORM-only libs (`exposed`, `flask-login`, `vapor`, `ory-kratos-password`) | Little privacy-verb topology beyond auth/store; low ROI for 5.2. |

---

## Proposed annotation strategy for 5.2

1. **One case row per expected asserted verb** on subject `${type}:${name}` (set-valued). Actors never receive `dataActions` (DA-1).
2. **Author from pinned source + PRD**, with `rationale` citing file/lines. Never copy scanner `properties.dataActions`.
3. **Reuse existing component subject keys** where the verb applies to that node; do not invent parallel identities.
4. **Relay:** only `expected.status: ambiguous` or omit asserted label; if recording a candidate expectation, keep it out of positive denominators (adapter already excludes `status: candidate`).
5. **`log`:** unless a PII-gated logger span is added to an exhaustive scope, rely on fixture eval for the ≥3 floor rather than weak corpus guesses.
6. **Extend `layer-scopes.yaml`** with a `data_actions` section per selected repo (`review_state: proposed` until human accept). Start from the intersection of component scope + any added collect/display files (e.g. vgs `views.py`).
7. **Manifest `coverage.layers`:** add `data_actions` when gold lands (5.2).

Schema note: `tests/benchmark/schema.ts` and `to-eval-cases.ts` already list/map `data_actions` → eval layer `data-actions`. Task **5.3** should verify wiring end-to-end, not invent the layer name.

---

## Suggested 5.2 annotation order

1. `vgs-django` — expand scope → gold collect/store/disclose/display (+ relay candidate note)
2. `easy-school` — store positives (starter parity)
3. `ghost` — bulk store/disclose/collect
4. `spree` — bulk store/payment verbs
5. `hyperswitch-vault` + `posthog-user` — transform/delete specialty
6. Optional padding: `auth0-express`, `spring-petclinic`, `medusa-customer`

Stop when ≥50 accepted rows and verb floors are met; do not expand discourse/wordpress in the same pass.

---

## Explicit non-goals for this task (5.1)

- No `annotations/data_actions.yaml` yet (that is **5.2**)
- No scorecard promotion
- No new third-party repositories beyond the existing pinned corpus
- No Kanbus records

---

## Human review asks (only blockers)

None for proceeding into 5.2 on Tier A/B as listed. Ask before:

- Adding a **new** external repo not already under `tests/benchmark/repos/`
- Asserting **`relay`** as a gold positive
- Expanding `discourse` / full `wordpress` / `magento` trees into data-actions exhaustive scopes

---

## Verification performed

- Reviewed manifests + `layer-scopes.yaml` for all 29 packets
- Inspected materialized sources under `tests/benchmark/.cache/repos/` for starters and Tier A/B (source semantics, not scanner output)
- Confirmed `schema.ts` already admits `data_actions` as a benchmark layer
