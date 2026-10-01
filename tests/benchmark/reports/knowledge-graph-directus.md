# Knowledge graph on directus (KDATAP-a528cd)

`scripts/scan-graph.ts --root <directus@a6c460a7> --out <dir>` with graphify 0.9.73, 2026-10-01.

| | Count |
|---|---|
| graphify nodes / links | 5,448 / 17,951 |
| DataParade nodes | 1,173: 785 occurrences, 160 data item groups, 151 data flows, 70 components, 7 data items |
| DataParade links | 3,246 |
| Bridge links to graphify nodes | 1,566: `occurs_in` 664, `observed_in` 510, `defined_in` 392 |
| Bridge targets by kind | file 541, method 433, function 283, const 244, class 65 |
| Bridge targets missing from graphify's graph | 0 |
| Dangling endpoints | 0 |

Checks:
- NetworkX `compose` of both files: 6,621 nodes, 39,003 edges.
- graphify `validate_extraction` on the combined node and edge lists: 0 errors.
- graphify's MCP loader (`serve._load_graph`) opens the combined graph.
- `graphify path "email:user" ".registerUser()" --undirected` on the combined graph:
  `email:user <--occurrence_of [INFERRED]-- email @ api/src/services/users.ts:524 --occurs_in [EXTRACTED]--> .registerUser()`
- The 114 email occurrences in `api/src/services/users.ts` resolve to methods such as `.registerUser()` (22), `.requestPasswordReset()` (11), `.inviteUser()` (10), `.getUserByEmail()` (7).
