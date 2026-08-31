# Ruby Patterns (CLI Scanner)

This document describes the Ruby/Rails patterns implemented by the CLI codebase
scanner.

The Ruby analyzer emits `RawFinding[]` using the **shared pattern IDs** from
`core/types/detection.ts`:

- `express_route`
- `database_connection`
- `external_api_call`
- `auth_middleware`
- `config_file`
- `env_variable`
- `lambda_handler`

## Structure

- **YAML configuration** at `cli/patterns/ruby.patterns.yaml`
- **Config loader** (`cli/src/analyzers/ruby/ruby-detection-config.ts`)
- **Parser** (`cli/src/analyzers/ruby/parser.ts`): require / class / module / def / calls
- **Detectors** (`cli/src/patterns/detectors/ruby.ts`) inside shared `matchPatterns()`

### Require path vs Bundler gem matching

| Field | Shape | Example |
| --- | --- | --- |
| `requirePaths` | `require` path | `faraday`, `sidekiq/web` |
| `gemNames` | Gemfile / lock gem | `rails`, `stripe`, `devise` |

Manifest scanners feed gems as `gem:<name>` so they stay disjoint from require
paths. This matters for Rails/Zeitwerk apps that rarely `require` gems.

## Routes

- **Rails** — gated to `config/routes.rb`, `config/routes/**`, or
  `Rails.application.routes.draw` (`get`/`post`/`resources`/`root`/`mount`;
  `root` → `GET /`)
- **Sinatra** — `require "sinatra"` + `get "/path"`
- **Grape** — `grape` require/gem + verb DSL
- **gRPC** — `grpc` gem / `::Service` / `GRPC::RpcServer`

## Database / HTTP / Auth / Env

- DB: ActiveRecord (+ `rails`/`activerecord`), `pg`/`mysql2`/`sqlite3`/`trilogy`,
  Sequel, Mongoid, Redis, elasticsearch/opensearch, aws-sdk-dynamodb, plus
  `database_url` connection-string sniff
- HTTP: Faraday, HTTParty, RestClient, `Net::HTTP`, Typhoeus, Excon, http.rb,
  Stripe, gRPC client
- Auth: Devise, Doorkeeper, OmniAuth, JWT, Rodauth, Pundit, bearer headers
- Env: `ENV["X"]`, `ENV.fetch`, dotenv, `Rails.application.credentials` /
  `config_for`
- Serverless: `aws-sdk-rails` / `lamby`, GCP `functions_framework`

## Manifests

`Gemfile` and `Gemfile.lock` are walked by
`detectRubyPatternsFromDependencyManifests`. `Gemfile` is also a service-section
marker (like `composer.json` / `Cargo.toml`).
