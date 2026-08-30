# Annotation pass

## Repository / fixture

`tests/fixtures/jvm-manifests-basic`

## Scope

Reviewed Spring YAML manifests for personal-data eval gold:

- `src/main/resources/application.yml` — datasource `username` and `password` properties
- `src/main/resources/bootstrap.yml` — secondary datasource `username` for multi-file roll-up

Gold lives in `tests/eval/layers/raw-hits/cases.ts`, `tests/eval/layers/mentions/cases.ts`, and `tests/eval/layers/data-items/cases.ts` under fixture id `jvm-manifests-basic`.

## Findings in this pass

- `KDATAP-e230d006-629a-4811-9938-54ecba3082ca` — datasource username (`raw-jvm-yaml-username`, `mention-jvm-yaml-username`, `data-item-jvm-username` and multi-file roll-up cases)
- `KDATAP-fd8a62eb-3447-4ded-be4e-b2e31be8b1ee` — datasource password (`raw-jvm-yaml-password`, `mention-jvm-yaml-password`, `data-item-jvm-password`)

## Human review

Accepted. Ryan accepted this labeling pass after live `scan()` / PII-matcher review.
