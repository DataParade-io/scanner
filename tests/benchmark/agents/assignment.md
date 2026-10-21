# Assignment

You are analysing the source code of the repository in the current directory. Find every component and every data flow in it, and write them to `facts.json` in this directory.

## What to find

Components are the parts of the system that handle data:
- `asset`: something that is part of this system (a database, an API surface, a service, a cache, a config store, an authentication service).
- `actor`: a kind of person who uses or administers the system (a customer, an admin, an employee).
- `third_party`: an external service the system integrates with (an auth provider, a payment processor, an email provider, another SaaS service).

A data flow is personal data moving from where the code holds or produces it (a model, a form, a request handler, a variable) into something that stores or receives it (a database write, an outbound API call, a queue, a file). The source can be the data or the model itself; it does not have to be a component. The target is the component that stores or receives the data. The evidence is the lines where the data is written or sent, not where it is declared.

Worked example, from an imaginary app that is not in this repository. A Flask handler builds a `Subscriber(email=form.email.data)` model and calls `db.session.add(subscriber)`; later it posts the same email to a mailing-list vendor with `requests.post(VENDOR_URL, json={"email": email})`. That is two flows: source "Subscriber email" into the target component "App database" (type `database_query`, evidence = the `db.session.add` lines), and source "Subscriber email" into the target component "Mailing-list vendor" (type `api_call`, evidence = the `requests.post` lines).

Look at the actual code. Do not report components or flows you cannot point to in a file. Be complete, but do not invent items.

## Output format

Write one JSON file, `facts.json`:

```json
{
  "schemaVersion": 1,
  "components": [
    { "name": "App database", "type": "asset", "subType": "database",
      "evidence": [ { "filePath": "app/models.py", "startLine": 12, "endLine": 20 } ] }
  ],
  "dataFlows": [
    { "source": "Subscriber email", "target": "App database", "type": "database_query",
      "evidence": [ { "filePath": "app/views.py", "startLine": 31, "endLine": 33 } ] }
  ]
}
```

Rules:
- `type`, `subType` and the data flow `type` must come from `vocabulary.json` in this directory. Read it first. Each `subType` must be one listed under its component `type`.
- A flow's `source` is a short free-text label for the data or model it starts from. Its `target` must be the `name` of a component in the same file. Component names must be unique.
- `evidence` points to the code that shows the item: repository-relative `filePath` (no leading `/`) and 1-based `startLine` and `endLine`. Keep spans tight (the class, function or statement that shows it), and give at least one span per item.
- Report one component per distinct thing in the code (for example each separate database model or table is its own component), not one summary component for the whole repository.

## Check your work

Run `node .tools/validate-facts.js facts.json`. Fix every issue it reports and run it again until it prints `OK`. When it prints `OK`, you are done; reply with one line stating the counts.
