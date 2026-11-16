import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import { flowAuthentication } from "../../../src/data-flow/flow-authentication";

/** Authentication evidence on flows (DATAP-912). */

function flow(locations: Array<[string, number]>, type: DetectedDataFlow["type"] = "api_call"): DetectedDataFlow {
  return {
    id: "flow_1",
    sourceComponentId: "cmp_app",
    targetComponentId: "cmp_vendor",
    type,
    confidence: 0.9,
    sourceLocations: locations.map(([filePath, line]) => ({ filePath, startLine: line, endLine: line })),
  };
}

function files(map: Record<string, string[]>): Map<string, string[]> {
  return new Map(Object.entries(map));
}

/** 1-based line of the first line containing `needle`. */
function lineOf(lines: string[], needle: string): number {
  const i = lines.findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`no line contains ${needle}`);
  return i + 1;
}

describe("flowAuthentication", () => {
  it("follows a headers helper to a Basic Authorization header", () => {
    const code = [
      "import base64",
      "import httpx",
      "",
      "def _crisp_auth_headers() -> dict:",
      "    token = base64.b64encode(f'{ID}:{KEY}'.encode()).decode()",
      "    return {",
      '        "Authorization": f"Basic {token}",',
      '        "X-Crisp-Tier": "plugin",',
      "    }",
      "",
      "",
      "async def send(website_id: str, text: str) -> bool:",
      "    async with httpx.AsyncClient(timeout=30) as client:",
      "        resp = await client.post(",
      '            f"{CRISP_API_BASE}/website/{website_id}/message",',
      "            headers=_crisp_auth_headers(),",
      "            json={'content': text},",
      "        )",
    ];
    const auth = flowAuthentication(flow([["crisp.py", lineOf(code, "client.post(")]]), files({ "crisp.py": code }));
    expect(auth?.status).toBe("seen");
    expect(auth?.kinds).toEqual(["basic"]);
    expect(auth?.evidence[0]).toEqual({ kind: "basic", filePath: "crisp.py", line: lineOf(code, "Basic") });
  });

  it("reads a local header dict and does not borrow headers from another function", () => {
    const code = [
      "async def _api(path: str):",
      "    async with httpx.AsyncClient() as client:",
      "        return await client.get(",
      '            f"{OWN_API}{path}",',
      '            headers={"Authorization": f"Bearer {OWN_TOKEN}"},',
      "        )",
      "",
      "",
      "async def open_dm(bot_token: str, user_id: str):",
      '    headers = {"Authorization": f"Bot {bot_token}"}',
      "    async with httpx.AsyncClient(timeout=15) as client:",
      "        return await client.post(",
      '            f"{DISCORD_API}/users/@me/channels",',
      "            headers=headers,",
      "            json={'recipient_id': user_id},",
      "        )",
    ];
    const auth = flowAuthentication(flow([["discord.py", lineOf(code, "client.post(")]]), files({ "discord.py": code }));
    expect(auth?.kinds).toEqual(["api_key"]);
    expect(auth?.evidence.map((e) => e.line)).toEqual([lineOf(code, "Bot {bot_token}")]);
  });

  it("reports Google service-account credentials as oauth", () => {
    const code = [
      "def send(msg):",
      "    from google.oauth2 import service_account",
      "    from googleapiclient.discovery import build",
      "",
      "    creds = service_account.Credentials.from_service_account_file(SA_JSON)",
      "    service = build('gmail', 'v1', credentials=creds)",
      "    service.users().messages().send(userId='me', body=msg).execute()",
    ];
    const auth = flowAuthentication(flow([["mail.py", lineOf(code, "build('gmail'")]]), files({ "mail.py": code }));
    expect(auth?.kinds).toEqual(["oauth"]);
  });

  it("finds a token in the URL path", () => {
    const code = [
      "async def check(bot_token: str):",
      "    async with httpx.AsyncClient(timeout=10) as client:",
      '        return await client.get(f"https://api.telegram.org/bot{bot_token}/getMe")',
    ];
    const auth = flowAuthentication(flow([["tg.py", 3]]), files({ "tg.py": code }));
    expect(auth?.kinds).toEqual(["api_key"]);
  });

  it("reads the client construction when the flow cites an SDK import", () => {
    const code = [
      "from slack_bolt.async_app import AsyncApp",
      "",
      "SLACK_BOT_TOKEN = config.SLACK_BOT_TOKEN",
      "",
      "app = AsyncApp(token=SLACK_BOT_TOKEN)",
      "",
      "def handler(event):",
      '    headers = {"Authorization": f"Bearer {OTHER}"}',
    ];
    const auth = flowAuthentication(flow([["bot.py", 1]]), files({ "bot.py": code }));
    expect(auth?.kinds).toEqual(["api_key"]);
    expect(auth?.evidence.map((e) => e.line)).toEqual([5]);
  });

  it("gives none_seen for a public request", () => {
    const code = [
      "async def first_product(domain: str):",
      "    async with httpx.AsyncClient(timeout=10) as client:",
      '        return await client.get(f"https://{domain}/products.json?limit=1")',
    ];
    expect(flowAuthentication(flow([["shop.py", 3]]), files({ "shop.py": code }))).toEqual({
      status: "none_seen",
      kinds: [],
      evidence: [],
    });
  });

  it("does not check database flows or flows with no evidence", () => {
    expect(flowAuthentication(flow([["db.py", 1]], "database_query"), files({ "db.py": ["x"] }))).toBeUndefined();
    expect(flowAuthentication(flow([]), files({}))).toBeUndefined();
  });

  it("reads TypeScript headers", () => {
    const code = [
      "export async function createIssue(token: string, body: unknown) {",
      "  return fetch(`${GITHUB_API}/repos/acme/app/issues`, {",
      "    method: 'POST',",
      "    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },",
      "    body: JSON.stringify(body),",
      "  });",
      "}",
    ];
    const auth = flowAuthentication(flow([["gh.ts", 2]]), files({ "gh.ts": code }));
    expect(auth?.kinds).toEqual(["bearer"]);
  });
});
