# Component Taxonomy

The canonical definition of the component taxonomy is **`patterns/component-taxonomy.yaml`**. That file is the single source of truth for component types and subtypes.

## How to read it

- **Level 1 — Types**: `asset`, `third_party`, `actor`. Stable; do not add without a schema migration.
- **Level 2 — Subtypes**: the annotation category. Annotators pick from this list. Metrics aggregate by subtype.
- **Level 3 — Names**: the detected instance (e.g. `third_party:stripe`). Subject keys are `${type}:${name}`.

## What refers to it

- **Detector YAMLs** (`patterns/classifier/*.yaml`) map patterns to subtypes declared in the taxonomy. They do not define new subtypes.
- **`src/config/property-detection-config.ts`** groups subtypes (cloud, on-prem, main-app) using subtypes from the taxonomy.
- **Corpus annotations** (`tests/benchmark/repos/*/annotations/*.yaml`) label components with subtypes from the taxonomy.

## How they stay in sync

`tests/unit/taxonomy.spec.ts` loads the taxonomy and every classifier YAML and the TS config, then asserts every subtype used in code exists in the taxonomy. If someone adds a subtype to a detector but not to the taxonomy, the test fails.

**To add a new subtype:** add it to `patterns/component-taxonomy.yaml` first, then reference it from the detector YAML. Do not invent subtypes in detector code.

## Current subtypes

Do not copy this list into other docs — it will drift. Run `rg "^  - id:" patterns/component-taxonomy.yaml` for the live list, or read the YAML directly.
