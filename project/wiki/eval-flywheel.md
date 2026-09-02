# Gold review on the board

Each corpus data-item and data-flow row is a **finding**. The custom board tracks review with three statuses:

| Column | Meaning |
| --- | --- |
| Proposed | Still under consideration |
| Accepted | Human-accepted gold |
| Rejected | Not gold |

Do not file per-layer sub-tasks for one finding.

**Annotation** cards are labeling-pass notes. They are not the per-label queue. Sample-app Jest gold is finished and sits in Done.

Agents may edit Markdown under `findings/` and `annotations/`. Do not edit JSON under `project/issues/` or `project/events/`.
