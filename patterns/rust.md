# Rust Patterns (CLI Scanner)

This document describes the Rust patterns implemented by the CLI codebase
scanner.

The Rust analyzer emits `RawFinding[]` using the **shared pattern IDs** from
`core/types/detection.ts`:

- `express_route`
- `database_connection`
- `external_api_call`
- `auth_middleware`
- `config_file`
- `env_variable`
- `lambda_handler`

## Structure

- **YAML configuration** at `cli/patterns/rust.patterns.yaml`
- **Config loader** (`cli/src/analyzers/rust/rust-detection-config.ts`)
- **Parser** (`cli/src/analyzers/rust/parser.ts`): `use` / `mod`, structs/enums/traits, fns, calls
- **Detectors** (`cli/src/patterns/detectors/rust.ts`) inside shared `matchPatterns()`

### Import path vs Cargo crate matching

| Field | Shape | Example |
| --- | --- | --- |
| `importPaths` | `use` path (`::`) | `axum`, `sqlx::PgPool` |
| `crateNames` | Cargo.toml key | `axum`, `sea-orm` |

Manifest scanners feed crates as `crate:<name>` so they stay disjoint from
`use` paths.

## Routes

- **Axum** — `.get/.post/...("/path", handler)`
- **Actix-web** — `.route("/path")` / `#[get("/path")]`
- **Rocket** — `#[get("/path")]`
- **tonic** — gRPC `Server::builder` / `.add_service` / `*Server`

## Database / HTTP / Auth / Env

- DB: sqlx, diesel, sea-orm, redis, mongodb, tokio-postgres, deadpool-postgres,
  elasticsearch/opensearch, aws-sdk-dynamodb, rusqlite, clickhouse (+ `sqlx_url`
  SQL URL literals)
- HTTP: reqwest, hyper, ureq, awc, tonic client
- Auth: jsonwebtoken, oauth2, axum/actix bearer/session cues
- Env: `env::var`, dotenvy, config crate
- Serverless: AWS `lambda_runtime` (AWS-focused)

## Dependency manifests

`Cargo.toml` `[dependencies]` / `[dev-dependencies]` / `[build-dependencies]` /
`[workspace.dependencies]`. `target/` is excluded by default.
