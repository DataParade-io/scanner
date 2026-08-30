# Annotation pass

## Repository / fixture

`tests/fixtures/dotnet-manifests-basic`

## Scope

Reviewed the .NET manifest fixture for personal-data eval gold:

- `src/Api/appsettings.json` — `ConnectionStrings.DefaultConnection` with `Username=app` token
- `src/Api/Api.csproj` — scanned for completeness; no additional gold cases filed

Gold lives in `tests/eval/layers/raw-hits/cases.ts`, `tests/eval/layers/mentions/cases.ts`, and `tests/eval/layers/data-items/cases.ts` under fixture id `dotnet-manifests-basic`.

## Findings in this pass

- `KDATAP-5f3c3d6d-c6e5-4224-9981-00b7cbadf6ba` — connection-string Username (`raw-dotnet-connection-username`, `mention-dotnet-connection-username`, `data-item-dotnet-username`)

## Human review

Accepted. Ryan accepted this labeling pass after live `scan()` / PII-matcher review.

## Exhaustive scope (precision)

`appsettings.json` and `Api.csproj` are a closed world. Accepted positives include the connection-string username plus Npgsql, cache, Stripe, Sentry, and AWS package detections. Extra hits in these files lower precision.
