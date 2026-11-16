import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import { flowControls } from "../../../src/data-flow/flow-controls";

/** Control evidence on flows (DATAP-915). */

function flow(locations: Array<[string, number]>, extra: Partial<DetectedDataFlow> = {}): DetectedDataFlow {
  return {
    id: "flow_1",
    sourceComponentId: "cmp_app",
    targetComponentId: "cmp_vendor",
    type: "api_call",
    confidence: 0.9,
    sourceLocations: locations.map(([filePath, line]) => ({ filePath, startLine: line, endLine: line })),
    ...extra,
  };
}

const files = (map: Record<string, string[]>) => new Map(Object.entries(map));
const lineOf = (lines: string[], needle: string) => lines.findIndex((l) => l.includes(needle)) + 1;
const ids = (e: Array<{ control: string }> | undefined) => [...new Set((e ?? []).map((x) => x.control))];

describe("flowControls", () => {
  it("resolves a top-level URL constant and reads the timeout", () => {
    const code = [
      'CRISP_API_BASE = "https://api.crisp.chat/v1"',
      "",
      "async def send(website_id: str):",
      "    async with httpx.AsyncClient(timeout=30) as client:",
      '        return await client.post(f"{CRISP_API_BASE}/website/{website_id}/message")',
    ];
    const e = flowControls(flow([["crisp.py", lineOf(code, "client.post")]]), files({ "crisp.py": code }));
    expect(ids(e)).toEqual(["timeout", "tls"]);
    expect(e!.find((x) => x.control === "tls")!.line).toBe(1);
  });

  it("reports plain HTTP to a remote host and turned-off certificate checks as weakening", () => {
    const code = [
      "def fetch():",
      '    return requests.get("http://legacy.partner.net/feed", verify=False)',
    ];
    const e = flowControls(flow([["feed.py", 2]]), files({ "feed.py": code }));
    expect(ids(e)).toEqual(["plaintext_http", "tls_verify_disabled"]);
    expect(e!.every((x) => x.effect === "weakens")).toBe(true);
  });

  it("does not count local hosts, comments or timeout 0 as TLS or a timeout", () => {
    const code = [
      "export async function ping() {",
      "  // see https://docs.example.com",
      "  return axios.get('http://localhost:8080/health', { timeout: 0 });",
      "}",
    ];
    const e = flowControls(flow([["ping.ts", 3]]), files({ "ping.ts": code }));
    expect(ids(e)).toEqual(["timeout_disabled"]);
  });

  it("does not read docstrings or documentation links", () => {
    const code = [
      "async def balance():",
      '    """Get balance. GET https://api.stripe.com/v1/balance',
      "    Official: https://docs.stripe.com/api",
      '    """',
      "    # https://example.org",
      "    return await nexus_call('GET', path)",
      "",
      "def note():",
      '    "Docs: https://developers.facebook.com/docs/whatsapp"',
    ];
    expect(flowControls(flow([["pay.py", 6]]), files({ "pay.py": code }))).toEqual([]);
    expect(flowControls(flow([["pay.py", 9]]), files({ "pay.py": code }))).toEqual([]);
    // The endpoint lookup skips docstrings too.
    const e = flowControls(flow([["pay.py", 6]], { endpoint: "https://api.stripe.com/v1/balance" }), files({ "pay.py": code }));
    expect(e).toEqual([]);
  });

  it("reads the flow endpoint and cites the line that holds its host", () => {
    const code = ['VENDOR = "https://api.vendor.io"', "", "", "", "async def go(url):", "    return await client.get(url)"];
    const e = flowControls(flow([["go.py", 6]], { endpoint: "https://api.vendor.io/v2/items" }), files({ "go.py": code }));
    expect(e).toEqual([{ control: "tls", effect: "mitigates", filePath: "go.py", line: 1 }]);
    // No line holds the host: no evidence from the endpoint.
    const other = ["async def go(url):", "    return await client.get(url)"];
    expect(flowControls(flow([["go.py", 2]], { endpoint: "https://api.vendor.io/v2" }), files({ "go.py": other }))).toEqual([]);
  });

  it("keeps only client-constructor controls for an SDK import", () => {
    const code = [
      "from openai import OpenAI",
      "",
      'BASE_URL = "https://api.openai.com"',
      "client = OpenAI(timeout=20)",
    ];
    const e = flowControls(flow([["llm.py", 1]]), files({ "llm.py": code }));
    expect(ids(e)).toEqual(["timeout"]);
  });

  it("does not credit an SDK flow with a timeout set on another client in the file", () => {
    const code = [
      "import boto3",
      "",
      'table = boto3.resource("dynamodb").Table("posts")',
      "",
      "async def upload():",
      "    async with httpx.AsyncClient(timeout=60.0) as client:",
      "        await client.post(URL)",
    ];
    expect(flowControls(flow([["up.py", 1]]), files({ "up.py": code }))).toEqual([]);
  });

  it("returns an empty list when nothing is seen, and skips database flows", () => {
    const code = ["def go():", "    return client.get(path)"];
    expect(flowControls(flow([["a.py", 2]]), files({ "a.py": code }))).toEqual([]);
    expect(flowControls(flow([["a.py", 2]], { type: "database_query" }), files({ "a.py": code }))).toBeUndefined();
  });
});
