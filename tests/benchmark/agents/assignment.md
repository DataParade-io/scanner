# Assignment

You are analysing the source code of the repository in the current directory. Find every component and every data flow in it, and write them to `facts.json` in this directory.

## What to find

Components are the parts of the system that handle data:
- `asset`: something that is part of this system (a database, an API surface, a service, a cache, a config store, an authentication service).
- `actor`: a kind of person who uses or administers the system (a customer, an admin, an employee).
- `third_party`: an external service the system integrates with (an auth provider, a payment processor, an email provider, another SaaS service).

Data flows are movements of data between two components (for example application code writing to a database, a client calling an API, an app sending data to a third party). A flow may also start and end at the same component when data is stored or processed inside it.

Look at the actual code. Do not report components or flows you cannot point to in a file. Be complete, but do not invent items.

## Output format

Write one JSON file, `facts.json`:

```json
{
  "schemaVersion": 1,
  "components": [
    { "name": "Student table", "type": "asset", "subType": "database",
      "evidence": [ { "filePath": "students/models.py", "startLine": 17, "endLine": 23 } ] }
  ],
  "dataFlows": [
    { "source": "Student table", "target": "Student table", "type": "database_query",
      "evidence": [ { "filePath": "students/models.py", "startLine": 17, "endLine": 23 } ] }
  ]
}
```

Rules:
- `type`, `subType` and the data flow `type` must come from `vocabulary.json` in this directory. Read it first. Each `subType` must be one listed under its component `type`.
- `source` and `target` of a flow are `name` values of components in the same file. Component names must be unique.
- `evidence` points to the code that shows the item: repository-relative `filePath` (no leading `/`) and 1-based `startLine` and `endLine`. Keep spans tight (the class, function or statement that shows it), and give at least one span per item.
- Report one component per distinct thing in the code (for example each separate database model or table is its own component), not one summary component for the whole repository.

## Check your work

Run `node .tools/validate-facts.js facts.json`. Fix every issue it reports and run it again until it prints `OK`. When it prints `OK`, you are done; reply with one line stating the counts.
