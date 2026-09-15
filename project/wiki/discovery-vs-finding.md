# Discovery vs Finding

These nouns are **not** synonyms. Use them as locked below. This repo has no OCSF types — do not invent them.

| Term | Meaning | Not |
| --- | --- | --- |
| **Discovery** | Scanner output / code evidence: the published `ScanResult` bundle (components + dataFlows), raw pattern hits (`RawFinding`), and personal-data eval evidence. | Not an OCSF security event. Not a Kanbus gold-label card. |
| **Finding** | A security-event / OCSF-ish record (Security Lake, GuardDuty, Inspector, …). Reserved for that sense. | Not scanner output. |
| **Kanbus finding** | Gold-label review card (`--type finding`, artifacts under `findings/`). Always say **Kanbus finding** in prose. | Not a Discovery. Not an OCSF Finding. |

## Contract

- Code symbol for the published bundle stays **`ScanResult`**.
- Product/docs noun for that bundle (plus raw pattern hits) is **Discovery**.
- `OrchestratorScanResult.findings: RawFinding[]` is raw Discovery / pattern hits, not Findings.
- TypeScript names such as `RawFinding`, `PersonalDataFinding`, and `CanonicalScannerFinding` are leftover mush. Leave the symbols; describe them as Discovery evidence in human-facing text.

## Evaluation layers

Headline Discoveries are scored on `mentions`, `data-items`, `components`, and `data-flows`. `raw-hits` is diagnostic only.

See also [Four-layer scanner evaluation](four-layer-evaluation.md) and [Gold review](eval-flywheel.md) (Kanbus findings only).
