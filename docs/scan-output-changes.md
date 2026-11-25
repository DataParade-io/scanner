# Scan output changes

This page lists changes to the scan result that consumers can see. The newest change is
first. Read it before you upgrade the scanner in a tool that stores or compares scan
results.

## Flow labels, interaction channels and structural flows

Pull requests 122, 124 and 123. Kanbus: KDATAP-ea0f50.

### Edge names

`engineering.name` on a graph edge was `Source → Target (api call)` for most flows. The
label in the parentheses now says what the flow is:

| Flow | Old label | New label (examples) |
| --- | --- | --- |
| Vendor SDK call | api call | `Vendor SDK`, `Vendor SDK · HTTPS` |
| HTTP client call | api call | `HTTPS request`, `HTTP request` |
| GraphQL call | api call | `GraphQL · HTTPS` |
| MCP call | api call | `MCP · stdio`, `MCP` |
| Database | database query | `SQL`, `Redis`, `MongoDB` |
| Structural edge | api call | `uses`, `exposes`, `depends on`, `provisions` |
| Auth middleware | api call | `authenticates via` |
| Person to asset | api call | `Web GUI`, `CLI`, `Direct API`, `Mobile app`, `Desktop app`, `interacts` |

A call with no protocol, client or transport evidence still reads `api call`. No detector
sets `protocol: "rest"` today, so `REST` labels appear only if a flow already carries that
protocol. A tool that matches on `(api call)` or parses the name must read the new fields
instead.

### New flow fields

Each field is optional on `DetectedDataFlow` and in the scan result schema.

- `relationship`: `invokes`, `queries`, `publishes`, `consumes`, `interacts`,
  `authenticates_via`, `exposes`, `uses_in_process`, `depends_on` or `provisions`.
- `protocol`: for example `rest`, `graphql`, `grpc`, `mcp`, `sql`, `redis`, `kafka`,
  `otlp`, `vendor_sdk` or `unknown`.
- `transport`: for example `https`, `http`, `websocket`, `stdio` or `in_process`.
- `client`: the HTTP library or the SDK package that makes the call, such as `fetch` or
  `@sendgrid/mail`. It is never the scanned project's own package name.
- `channel`: on person-to-asset flows, the way a person reaches the asset: `web_gui`,
  `mobile_app`, `desktop_app`, `cli`, `mcp` or `api_direct`.
- `channelEvidence`: the signals behind `channel`, each with `signal`, `filePath` and
  `line`.

`type` and flow ids do not change.

`engineering.protocol` is now set only from evidence. An endpoint or HTTP method alone no
longer sets it to `rest` (DATAP-937), and internal fetches are `unknown` unless the path
says GraphQL.

### AI agent actor

An MCP server is modelled as person → AI agent → MCP server. The AI agent is a new actor
component named `AI agent`, with `subType: "automated_service"` and
`properties.actorKind: "ai_agent"`. The agent → server flow has `channel: "mcp"` and
`protocol: "mcp"`.

### Default User actor dropped for library packages

The synthetic edge from the injected `User` actor into a library package with no
human-facing signal is removed. If that leaves the actor with no edges, the actor is
removed too. Evidence-backed actor edges stay.

CLI channels come only from runtime dependencies and real entry points: a `bin` entry,
`console_scripts` or `[project.scripts]` targets, `__main__.py` modules, and Go
`package main` or `cmd/` files. devDependencies and scripts such as a seed script do not
count.

### No threats on structural flows

`strideThreatsForFlow` returns `[]` for flows whose `relationship` is `uses_in_process`,
`exposes`, `depends_on` or `provisions`. These flows also no longer affect an external
entity's status.

### STRIDE rule ids

The STRIDE table is version 3. `ruleId` and `statusRuleId` read `stride/v3/...` instead
of `stride/v2/...`. Statuses keyed on a v2 rule id do not carry over.

### Evidence window

Authentication and control evidence now stops at the end of the enclosing function:
Python by indentation; JavaScript, TypeScript, Go, and Java or C# methods by braces. A
nested function or callback that closes before the call does not count as the enclosing
function. In other languages the window stops at the next detected function definition.
A flow no longer takes a timeout, TLS or credential from the next function, so some
statuses go from `mitigated` back to `unknown`.
