# Assignment

You are analysing the source code of the repository in the current directory. Find every component and every data flow in it, and write them to `facts.json` in this directory.

## What to find

## What counts as a component

A component is a building block of the software system that stores, handles or exchanges data, or a party that does. In the C4 vocabulary the DataParade ontology uses: the system is the whole application; its containers are applications and data stores inside it; its components are the logical building blocks inside those containers; an external system is something outside the system boundary; an actor is a person or role that uses it. The three component `type` values map onto this: `asset` is something inside the system (containers and the building blocks inside them), `third_party` is an external system, `actor` is an actor. Pick the `subType` that fits best from `vocabulary.json`; the examples below are from an imaginary invoicing app, not from this repository.

`asset` (inside the system):
- `database`: a real data store that holds records. Example: the PostgreSQL database the invoicing app is configured to connect to.
- `cache`: a cache or in-memory store. Example: the Redis instance the app uses for caching rendered invoices.
- `config`: configuration that holds settings or secrets the app reads. Example: the settings file that defines connection strings and feature flags.
- `auth_service`: code that handles authentication, sessions, tokens or credentials. Example: the module that issues and checks login tokens and stores session cookies.
- `api`: a route or controller surface that takes requests from outside. Example: the controller that serves the `/invoices` endpoints.
- `service`: any other internal service or worker that processes data and is not one of the above. Example: a background job that renders PDF invoices.

`actor` (a kind of person):
- `customer`: an end user of the product. Example: a customer who signs up and views their invoices.
- `admin`: someone who administers the system. Example: a back-office administrator who edits other users' accounts.
- `employee`: a staff member who uses an internal part of the system. Example: an accountant who approves refunds.

`third_party` (an outside service the code calls or relies on):
- `auth_provider`: an outside login or identity provider. Example: a "sign in with" single-sign-on provider.
- `email_provider`: an outside service that sends email. Example: a transactional email API.
- `payment_processor`: an outside service that takes payments. Example: a card-payment gateway.
- `saas_service`: any other outside service the code calls. Example: an address-verification API.

Granularity rules, which the reference labels follow:
- One data store per actual database or store, not one per model, table class or schema file. Ten model classes backed by one database are one `database` component.
- Authentication, session and token handling counts as an `auth_service` component, one per distinct mechanism.
- Route and controller surfaces count as `api` components.
- Each outside service the code calls is its own `third_party` component, with the subtype that fits its role.
- Prefer fewer, well-evidenced components over many guesses. Do not create a component for every file, class or table.

## What counts as a data flow

A data flow is personal data moving from where the code holds or produces it (a model, a form, a request handler, a variable) into something that stores or receives it (a database write, an outbound API call, a queue, a file). The source can be the data or the model itself; it does not have to be a component. The target is the component that stores or receives the data. The evidence is the lines where the data is written or sent, not where it is declared.

Worked example, from an imaginary app that is not in this repository. A Flask handler builds a `Subscriber(email=form.email.data)` model and calls `db.session.add(subscriber)`; later it posts the same email to a mailing-list vendor with `requests.post(VENDOR_URL, json={"email": email})`. That is two flows: source "Subscriber email" into the target component "App database" (type `database_query`, evidence = the `db.session.add` lines), and source "Subscriber email" into the target component "Mailing-list vendor" (type `api_call`, evidence = the `requests.post` lines).

## Read the code first

Read the code before you report anything.
- Open and read a file before you cite it as evidence. Never cite a line you have not read; a file name or a directory listing is not evidence.
- Evidence spans must come from lines you actually saw, and must be the lines that show the item.
- Prefer fewer, well-evidenced components and flows over many guesses. An item you could not confirm in the code should be left out.

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
