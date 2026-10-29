import type { FileInfo } from "../../../../src/core/types/file";
import type { RawFinding } from "../../../../src/core/types/detection";
import { detectPythonPatterns } from "../../../../src/analyzers/python/detector";
import { classifyRawFindings, dedupeComponents } from "../../../../src/classifier/classify";
import { componentScannerIdentityKey } from "../../../../src/eval/canonical/scanner/components";

/** DATAP-818: raw-HTTP destinations in Python resolve to the host the call reaches. */

const LIBRARIES = ["httpx", "requests", "aiohttp", "httpx_retries"];

function pythonFile(lines: string[], path = "app.py"): FileInfo {
  const content = lines.join("\n");
  return { path, name: path, content, language: "python", size: content.length };
}

function outbound(lines: string[], path?: string): RawFinding[] {
  return detectPythonPatterns(pythonFile(lines, path)).filter((f) => f.pattern === "external_api_call");
}

function services(findings: RawFinding[]): string[] {
  return [...new Set(findings.map((f) => f.properties.serviceName).filter((s): s is string => typeof s === "string"))].sort();
}

function span(f: RawFinding): string {
  return `${f.location.startLine}-${f.location.endLine}`;
}

describe("python outbound HTTP destinations (DATAP-818)", () => {
  describe("URL resolution", () => {
    it("reads a literal URL from a call that spans several lines", () => {
      const findings = outbound([
        "import httpx",
        "",
        "async def notify(chat_id: int, text: str) -> None:",
        "    async with httpx.AsyncClient(timeout=10) as client:",
        "        await client.post(",
        '            "https://api.telegram.org/bot123/sendMessage",',
        '            json={"chat_id": chat_id, "text": text},',
        "        )",
      ]);
      expect(services(findings)).toEqual(["telegram"]);
      expect(findings.map(span)).toEqual(["5-8"]);
    });

    it("resolves a module constant built from implicit concatenation and an f-string", () => {
      const findings = outbound([
        "import os",
        "import requests",
        'MEASUREMENT_ID = os.environ.get("GA_MEASUREMENT_ID", "")',
        "COLLECT_ENDPOINT = (",
        '    "https://www.google-analytics.com/mp/collect"',
        '    f"?measurement_id={MEASUREMENT_ID}"',
        ")",
        "",
        "def track(payload):",
        "    requests.post(COLLECT_ENDPOINT, json=payload, timeout=5)",
      ]);
      expect(services(findings)).toEqual(["google_analytics"]);
      expect(findings[0].location.startLine).toBe(10);
    });

    it("uses the default URL of os.environ.get / os.getenv", () => {
      const findings = outbound([
        "import os",
        "import requests",
        'HOOK = os.environ.get("LEAD_HOOK_URL", "https://hook.eu1.make.com/abc")',
        'OTHER = os.getenv("OTHER_URL", "https://api.crisp.chat/v1")',
        "",
        "def forward(lead):",
        "    requests.post(",
        "        HOOK,",
        "        json=lead,",
        "    )",
        "    requests.get(OTHER)",
      ]);
      expect(services(findings)).toEqual(["crisp", "make"]);
      expect(findings.find((f) => f.properties.serviceName === "make")?.location).toMatchObject({ startLine: 7, endLine: 10 });
    });

    it("joins a relative path with the client's base_url (constant and same-file helper)", () => {
      const findings = outbound([
        "import httpx",
        '_BASE_URL = "https://api.linkedin.com"',
        '_FB = "https://graph.facebook.com/v21.0"',
        '_IG = "https://graph.instagram.com/v21.0"',
        "",
        "def _base_for(token: str) -> str:",
        '    if token.startswith("IGAA"):',
        "        return _IG",
        "    return _FB",
        "",
        "class LinkedIn:",
        "    def __init__(self) -> None:",
        "        self._client = httpx.AsyncClient(base_url=_BASE_URL, timeout=30.0)",
        "",
        "    async def create(self, body):",
        '        return await self._client.post("/rest/posts", json=body)',
        "",
        "class Instagram:",
        "    def __init__(self, token: str) -> None:",
        "        self._client = httpx.AsyncClient(",
        "            base_url=_base_for(token),",
        "        )",
        "",
        "    async def _post(self, path: str, data: dict):",
        "        return await self._client.post(path, data=data)",
      ]);
      expect(services(findings)).toEqual(["facebook_graph", "instagram", "linkedin"]);
      expect(findings.find((f) => f.properties.serviceName === "linkedin")?.location.startLine).toBe(16);
      expect(findings.filter((f) => f.location.startLine === 25).map((f) => f.properties.serviceName).sort()).toEqual([
        "facebook_graph",
        "instagram",
      ]);
    });

    it("follows self attributes, @property f-strings and same-file helpers", () => {
      const findings = outbound(
        [
          "import aiohttp",
          "import httpx",
          "",
          "class Desk:",
          "    def __init__(self, website_id: str) -> None:",
          "        self.website_id = website_id",
          '        self.api_root = "https://api.crisp.chat/v1"',
          "",
          "    def _url(self, path: str) -> str:",
          '        return f"{self.api_root}/website/{self.website_id}/{path}"',
          "",
          "    async def reply(self, session_id: str, text: str) -> None:",
          "        async with aiohttp.ClientSession() as session:",
          '            await session.post(self._url(f"conversation/{session_id}/message"), json={"content": text})',
          "",
          "class Channel:",
          "    @property",
          "    def base_url(self) -> str:",
          '        return f"https://graph.facebook.com/{self.api_version}"',
          "",
          "    async def send(self, body):",
          '        url = f"{self.base_url}/{self.page_id}/feed"',
          "        async with httpx.AsyncClient() as client:",
          "            return await client.post(url, json=body)",
        ],
        "integrations/desk.py",
      );
      expect(services(findings)).toEqual(["crisp", "facebook_graph"]);
    });

    it("resolves a URL parameter through same-file callers and reports both sites", () => {
      const findings = outbound([
        "import httpx",
        '_BASE = "https://www.reddit.com"',
        "",
        "class Reddit:",
        "    def __init__(self) -> None:",
        "        self._http = httpx.AsyncClient(timeout=30.0)",
        "",
        "    async def submit(self, payload):",
        '        url = f"{_BASE}/api/submit"',
        "        return await self._post(url, data=payload)",
        "",
        "    async def _post(self, url: str, data=None):",
        "        resp = await self._http.post(url, data=data)",
        "        return resp.json()",
      ]);
      expect(services(findings)).toEqual(["reddit"]);
      expect(findings.map((f) => f.location.startLine).sort((a, b) => a - b)).toEqual([10, 13]);
    });
  });

  describe("unknown hosts and libraries", () => {
    it("reports an outbound call with no vendor when the host is unknown", () => {
      const findings = outbound([
        "import httpx",
        "",
        "async def post_json(url: str, body: dict) -> dict:",
        "    async with httpx.AsyncClient(timeout=10) as client:",
        "        response = await client.post(url, json=body)",
        "        return response.json()",
      ]);
      expect(findings).toHaveLength(1);
      expect(findings[0].name).toBe("outbound_http_call");
      expect(findings[0].properties.serviceName).toBeUndefined();
      expect(findings[0].properties.httpClientLibrary).toBe("httpx");
      expect(findings[0].location.startLine).toBe(5);
    });

    it("never names the HTTP library as the destination", () => {
      const findings = outbound([
        "import os",
        "import httpx",
        "import requests",
        "import aiohttp",
        "from httpx_retries import Retry, RetryTransport",
        "",
        "client = httpx.Client(transport=RetryTransport(retry=Retry(total=3)))",
        "session = requests.Session()",
        "",
        "def go(url):",
        '    client.get(os.environ["TARGET_URL"])',
        "    session.post(url)",
        '    requests.get("http://localhost:8000/health")',
        "",
        "async def other(u):",
        "    async with aiohttp.ClientSession() as s:",
        "        await s.get(u)",
      ]);
      expect(findings.length).toBeGreaterThan(0);
      for (const finding of findings) {
        expect(LIBRARIES).not.toContain(finding.properties.serviceName);
        expect(LIBRARIES.map((l) => `${l}_call`)).not.toContain(finding.name);
      }
      const components = classifyRawFindings(findings);
      for (const component of components) {
        expect(LIBRARIES).not.toContain(component.name.toLowerCase());
        expect(component.name.toLowerCase()).not.toMatch(/httpx|requests|aiohttp/);
      }
    });

    it("does not treat dict.get or other receivers as HTTP clients", () => {
      const findings = outbound([
        "import httpx",
        "",
        "def f(cfg: dict):",
        '    return cfg.get("https://api.telegram.org/x")',
      ]);
      expect(findings).toEqual([]);
    });
  });

  describe("graph.facebook.com routes", () => {
    const graphCall = (path: string, file: string): RawFinding[] =>
      outbound(
        [
          "import httpx",
          "",
          'GRAPH = "https://graph.facebook.com/v21.0"',
          "",
          "async def call(target_id: str, phone_number_id: str, ig_user_id: str, body: dict):",
          "    async with httpx.AsyncClient() as client:",
          `        return await client.post(f"{GRAPH}${path}", json=body)`,
        ],
        file,
      );

    it.each([
      ["/{target_id}/events", "app/ads/conversions.py", "meta_conversions_api", undefined],
      ["/{phone_number_id}/messages", "app/whatsapp/adapter.py", "whatsapp", undefined],
      ["/me/messages", "app/facebook/adapter.py", "facebook_messenger", undefined],
      ["/{ig_user_id}/messages", "app/instagram/adapter.py", "instagram", "messaging"],
      ["/{ig_user_id}/media", "app/instagram/adapter.py", "instagram", undefined],
      ["/{target_id}/feed", "app/facebook/adapter.py", "facebook_graph", undefined],
    ])("routes %s in %s to %s", (path, file, service, subType) => {
      const findings = graphCall(path, file);
      expect(services(findings)).toEqual([service]);
      expect(findings[0].properties.thirdPartySubType).toBe(subType);
    });
  });

  describe("SDK clients pointed at a URL", () => {
    it("names the provider of an OpenAI client's base_url and drops the OpenAI import finding", () => {
      const findings = outbound([
        "import os",
        "from openai import AsyncOpenAI",
        "",
        "fast = AsyncOpenAI(",
        '    base_url="https://api.cerebras.ai/v1",',
        '    api_key=os.environ.get("CEREBRAS_API_KEY", ""),',
        ")",
        'broad = AsyncOpenAI(base_url="https://openrouter.ai/api/v1")',
      ]);
      expect(services(findings)).toEqual(["cerebras", "openrouter"]);
      expect(findings.find((f) => f.properties.serviceName === "cerebras")?.location).toMatchObject({ startLine: 4, endLine: 7 });
    });

    it("keeps OpenAI when a client has no base_url", () => {
      const findings = outbound(["from openai import OpenAI", "", "client = OpenAI()"]);
      expect(services(findings)).toEqual(["openai"]);
    });

    it("resolves MCP-over-HTTP URLs, including a helper bound to a constant", () => {
      const findings = outbound([
        "import os",
        "from mcp.client.streamable_http import streamablehttp_client",
        "from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPServerParams",
        'SHOP = os.environ.get("SHOP_DOMAIN", "demo-store.myshopify.com")',
        "",
        "def mcp_url(shop: str) -> str:",
        '    return f"https://{shop}/api/mcp"',
        "",
        "async def run():",
        "    async with streamablehttp_client(mcp_url(SHOP)) as (read, write, _):",
        "        pass",
        "",
        'params = StreamableHTTPServerParams(url="https://api.linkedin.com/mcp")',
      ]);
      expect(services(findings)).toEqual(["linkedin", "shopify"]);
    });

    it("names Arize Phoenix from phoenix.otel.register(endpoint=...)", () => {
      const findings = outbound([
        "import os",
        "from phoenix.otel import register",
        'ENDPOINT = os.environ.get("PHOENIX_COLLECTOR_ENDPOINT", "https://app.phoenix.arize.com/v1/traces")',
        "",
        "def start(name: str) -> None:",
        "    register(",
        "        project_name=name,",
        "        endpoint=ENDPOINT,",
        "    )",
      ]);
      expect(services(findings)).toEqual(["arize_phoenix"]);
      expect(span(findings[0])).toBe("6-9");
    });
  });

  describe("(method, url) helpers", () => {
    it("treats an unresolved helper call with a catalog host as a request", () => {
      const findings = outbound(
        [
          "CRISP_API = 'https://api.crisp.chat/v1'",
          "",
          "async def create(site_id, payload, base_url=None):",
          "    api = _root(base_url)",
          "    url = f'{api}/website/{site_id}/conversation'",
          "    return await _post(url, payload)",
          "",
          "def _root(base_url):",
          "    return (base_url or CRISP_API).rstrip('/')",
          "",
          "async def _post(url, body):",
          "    return await nexus_call('POST', url, json=body)",
          "",
          "async def balance():",
          "    return await nexus_call('GET', 'https://api.stripe.com/v1/balance')",
        ],
        "atoms/crisp.py",
      );
      expect(services(findings)).toEqual(["crisp", "stripe"]);
      expect(findings.filter((f) => f.properties.serviceName === "crisp").map((f) => f.location.startLine).sort((a, b) => a - b)).toEqual([6, 12]);
    });

    it("ignores (method, url) calls whose host is not in the catalog", () => {
      const findings = outbound(["def f():", "    return call('GET', 'https://unknown-vendor.io/x')"]);
      expect(findings).toEqual([]);
    });
  });

  describe("components", () => {
    it("keeps one service's routed subtypes apart and keeps catalog names whole", () => {
      const findings = outbound(
        [
          "import httpx",
          'GRAPH = "https://graph.facebook.com/v21.0"',
          "",
          "async def dm(ig_user_id, body):",
          "    async with httpx.AsyncClient() as client:",
          '        await client.post(f"{GRAPH}/{ig_user_id}/messages", json=body)',
          '        await client.post(f"{GRAPH}/{ig_user_id}/media", json=body)',
          '        await client.post(f"{GRAPH}/{ig_user_id}/events", json=body)',
        ],
        "app/instagram/adapter.py",
      );
      const components = dedupeComponents(classifyRawFindings(findings)).filter((c) => c.type === "third_party");
      expect(components.map((c) => `${componentScannerIdentityKey(c)}/${c.subType}`).sort()).toEqual([
        "third_party:instagram/messaging",
        "third_party:instagram/saas_service",
        "third_party:meta_conversions_api/analytics",
      ]);
    });
  });
});
