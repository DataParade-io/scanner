# Corpus baseline — series-1

## Series

- Evaluation contract: 1.0.0
- Schema: baseline-artifact/1
- Predecessor: none
- Generated: 2026-08-31T12:00:00.000Z

## Fingerprint

- fingerprintDigest: sha256:fixture-fingerprint-digest
- scannerGitSha: fixture-sha-001
- corpusGoldDigest: sha256:fixture-corpus-digest
- evaluationContractVersion: 1.0.0
- scorecardVectorContractVersion: scorecard-vector/2
- taxonomyDigest: sha256:fixture-taxonomy
- conceptMapDigest: sha256:fixture-concept-map
- adapterMapDigest: sha256:fixture-adapter-map
- dependencyLockDigest: sha256:fixture-lock
- deterministicConfigurationDigest: sha256:fixture-config
- eligibilityProfileDigest: sha256:fixture-eligibility-profile
- enableAiInference: false

### Materialized sources

- fixture-packet: missing @ n/a (manifest aaaaaaaaaaaa); path does not exist

### Review state counts (total)

- accepted: 2
- needs_adjudication: 0
- proposed: 0
- rejected: 0

## Invariants

- baselineArtifactSchemaVersion: baseline-artifact/1
- canonicalContractVersion: 1.0.0
- eligibilityReasonSetVersion: eligibility-reasons/1
- groundTruthSchemaVersion: ground-truth/1
- scorecardVectorContractVersion: scorecard-vector/2

## Readiness

- status: not_evaluated
- evaluatedAt: n/a
- blockers: (none)

## Gold population

### mentions
- acceptedCanonicalCount: 2
- evaluablePositiveCount: 2
- distinctConceptLeaves: 1
- packetDiversity: 1 (fixture-packet)

### data-items
- acceptedCanonicalCount: 0
- evaluablePositiveCount: 0
- distinctConceptLeaves: 0
- packetDiversity: 0 (none)

### components
- acceptedCanonicalCount: 0
- evaluablePositiveCount: 0
- distinctConceptLeaves: 0
- packetDiversity: 0 (none)

### data-flows
- acceptedCanonicalCount: 0
- evaluablePositiveCount: 0
- distinctConceptLeaves: 0
- packetDiversity: 0 (none)

## Migration incomplete

- total: 1
- awaiting_flow_adjudication: 1

- data-flows: 1

## Scorecard (scorecard-vector/2)

- contract: scorecard-vector/2
- scanner: fixture-sha-001
- review states: accepted
- packets: 1

### mentions
- summary: empty
- gate: skip (no_eval_cases)
- recall: 50.0% [computable; 1/2]
- precision: 100.0% [computable; 1/1]
- negative pass rate: n/a [migration_incomplete_or_not_ready; 0/0]
- scope: reviewedFiles=1, processedFiles=1, locationlessFindings=0
- denominators: evaluablePositives=2, exhaustiveScopedFindings=1

### data-items
- summary: empty
- gate: skip (no_eval_cases)
- recall: n/a [migration_incomplete_or_not_ready; 0/0]
- precision: n/a [no_reviewed_scope; 0/0]
- negative pass rate: n/a [migration_incomplete_or_not_ready; 0/0]
- scope: reviewedFiles=0, processedFiles=0, locationlessFindings=0
- denominators: evaluablePositives=0, exhaustiveScopedFindings=0

### components
- summary: empty
- gate: skip (no_eval_cases)
- recall: n/a [migration_incomplete_or_not_ready; 0/0]
- precision: n/a [no_reviewed_scope; 0/0]
- negative pass rate: n/a [migration_incomplete_or_not_ready; 0/0]
- scope: reviewedFiles=0, processedFiles=0, locationlessFindings=0
- denominators: evaluablePositives=0, exhaustiveScopedFindings=0

### data-flows
- summary: empty
- gate: skip (no_eval_cases)
- recall: n/a [migration_incomplete_or_not_ready; 0/0]
- precision: n/a [no_reviewed_scope; 0/0]
- negative pass rate: n/a [migration_incomplete_or_not_ready; 0/0]
- scope: reviewedFiles=0, processedFiles=0, locationlessFindings=0
- denominators: evaluablePositives=0, exhaustiveScopedFindings=0

### Diagnostic: raw-hits
- recall: n/a
- precision: n/a
- denominators: evaluablePositives=0

## Capability coverage (diagnostic only)

- disclaimer: diagnostic_only_not_recall_denominator
### mentions
- caseWeighted: 0.0%
- distinctLeaf: 0.0%
- supportedCount: 0
- totalAcceptedPositives: 2

