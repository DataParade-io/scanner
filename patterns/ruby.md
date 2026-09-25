# Ruby and Rails detection

The Ruby analyzer models runtime architecture boundaries rather than Rails MVC
classes.

## Components

- `config/database.yml` emits the configured SQL datastore.
- Redis initializers and Rails Redis cache configuration emit cache assets.
- Rails routes emit one section API component. Route paths remain attached as
  evidence; controllers are not components.
- Concrete authentication mechanisms such as Devise, Warden, OmniAuth, JWT,
  bcrypt, sessions, and API keys emit auth-service assets. Repeated evidence for
  the same mechanism is merged.
- `Gemfile` and `Gemfile.lock` emit catalog-backed third parties with locked
  versions where available.
- `Net::HTTP`, HTTParty, Faraday, and RestClient calls emit outbound API
  findings, including literal URL evidence.

ActiveRecord models, concerns, controllers, jobs, mailers, serializers, and
ordinary service classes are source evidence only. They do not become assets
merely because they define a class or module.

## Routes

The Rails route detector recognizes literal HTTP verbs, `resources`,
`resource`, `namespace`, `scope`, `member`, `collection`, and mounted engines.
These declarations are grouped into the section API.

## Exclusions

Ruby parsing excludes generated or non-runtime paths including `spec`, `test`,
`vendor`, `tmp`, `log`, `coverage`, `db/migrate`, and `db/schema.rb`.

## Known limits

- The parser is intentionally structural and does not execute Ruby DSL code.
- Dynamically generated routes and dependencies are detected only when their
  static declarations are visible.
- A dependency must exist in the shared third-party catalog before a Gemfile
  declaration can become a canonical third-party component.
