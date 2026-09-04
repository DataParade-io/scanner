# Decomposition

Eval cases: `raw-dotnet-connection-username`, `mention-dotnet-connection-username`, `data-item-dotnet-username`.

| Layer | Subject key | Evidence (file:lines) | Expected | Labels | documentedGap |
| --- | --- | --- | --- | --- | --- |
| raw-hits | `raw_hit:username` | `src/Api/appsettings.json:8-8` | positive | username | no |
| mentions | `mention:username` | `src/Api/appsettings.json:8-8` | positive | username | no |
| data-items | `data_item:username` | `src/Api/appsettings.json:8-8` | positive | username | no |

Graph layers do not apply.
