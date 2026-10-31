import type { FileInfo } from "../../../../src/core/types/file";
import type { RawFinding } from "../../../../src/core/types/detection";
import { detectPythonPatterns } from "../../../../src/analyzers/python/detector";
import { classifyRawFindings, dedupeComponents } from "../../../../src/classifier/classify";
import { componentScannerIdentityKey } from "../../../../src/eval/canonical/scanner/components";
import { runWithPythonModuleIndex } from "../../../../src/patterns/detectors/source-module-index";
import { runWithOrganizationDomainsScope } from "../../../../src/classifier/organization-domains-scan-scope";
import {
  normalizeOrganizationName,
  ownerFromRemoteUrl,
  readGitRemoteOwner,
} from "../../../../src/patterns/detectors/git-remote-owner";
import { platformServiceDisplayName } from "../../../../src/config/third-party-detection-config";
import fs from "fs";
import os from "os";
import path from "path";

/** DATAP-818: raw-HTTP destinations in Python resolve to the host the call reaches. */

const LIBRARIES = ["httpx", "requests", "aiohttp", "httpx_retries"];

function pythonFile(lines: string[], path = "app.py"): FileInfo {
  const content = lines.join("\n");
  return { path, name: path, content, language: "python", size: content.length };
}

function outbound(lines: string[], path?: string): RawFinding[] {
  return detectPythonPatterns(pythonFile(lines, path)).filter((f) => f.pattern === "external_api_call");
}

/** Detect one file of a small repo, with the other files available for imports. */
function outboundInRepo(files: Record<string, string[]>, target: string): RawFinding[] {
  const infos = Object.entries(files).map(([path, lines]) => pythonFile(lines, path));
  const file = infos.find((f) => f.path === target)!;
  return runWithPythonModuleIndex(infos, () =>
    detectPythonPatterns(file).filter((f) => f.pattern === "external_api_call"),
  );
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
      expect(findings.map(span).sort()).toEqual(["2-2", "6-9"]);
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

  describe("same-repo imports", () => {
    const settings = [
      "import os",
      "",
      "class Settings:",
      '    FAST_LLM_BASE_URL = os.environ.get("FAST_LLM_BASE_URL", "https://api.cerebras.ai/v1")',
      '    ROUTER_BASE_URL = os.environ.get("ROUTER_BASE_URL", "https://openrouter.ai/api/v1")',
      "",
      "settings = Settings()",
    ];

    it("resolves a settings attribute imported with a relative import", () => {
      const findings = outboundInRepo(
        {
          "app/settings.py": settings,
          "app/llm.py": [
            "from openai import AsyncOpenAI",
            "from .settings import settings",
            "",
            "fast = AsyncOpenAI(base_url=settings.FAST_LLM_BASE_URL)",
            "router = AsyncOpenAI(base_url=settings.ROUTER_BASE_URL)",
          ],
        },
        "app/llm.py",
      );
      expect(services(findings)).toEqual(["cerebras", "openrouter"]);
      expect(findings.find((f) => f.properties.serviceName === "cerebras")?.location.startLine).toBe(4);
    });

    it("resolves a class attribute and a module constant through absolute imports", () => {
      const findings = outboundInRepo(
        {
          "src/app/settings.py": settings,
          "src/app/endpoints.py": ['TELEGRAM_API = "https://api.telegram.org"'],
          "src/app/notify.py": [
            "import httpx",
            "from app.settings import Settings",
            "from app import endpoints",
            "",
            "def send(text):",
            '    httpx.post(f"{endpoints.TELEGRAM_API}/bot1/sendMessage", json={"text": text})',
            "    httpx.post(Settings.ROUTER_BASE_URL)",
          ],
        },
        "src/app/notify.py",
      );
      expect(services(findings)).toEqual(["openrouter", "telegram"]);
    });

    it("does not resolve across files without the module index", () => {
      const findings = outbound([
        "from openai import AsyncOpenAI",
        "from .settings import settings",
        "fast = AsyncOpenAI(base_url=settings.FAST_LLM_BASE_URL)",
      ]);
      // The base URL stays unknown, so only the OpenAI SDK import is reported.
      expect(services(findings)).toEqual(["openai"]);
    });

    it("maps a runtime-host /api/mcp URL built by a Shopify class to shopify", () => {
      const repo = {
        "app/shopify_store.py": [
          "from dataclasses import dataclass",
          "",
          "@dataclass",
          "class ShopifyStore:",
          "    domain: str",
          "    endpoint_override: str | None = None",
          "",
          "    def mcp_endpoint(self) -> str:",
          '        return self.endpoint_override or f"https://{self.domain}/api/mcp"',
        ],
        "app/store_agent.py": [
          "from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPServerParams",
          "from .shopify_store import ShopifyStore",
          "",
          "def tools(store: ShopifyStore):",
          "    return StreamableHTTPServerParams(url=store.mcp_endpoint())",
        ],
      };
      const findings = outboundInRepo(repo, "app/store_agent.py");
      expect(services(findings)).toEqual(["shopify"]);
      expect(findings[0].location.startLine).toBe(5);
    });

    it("needs a Shopify name for the /api/mcp path rule", () => {
      const findings = outboundInRepo(
        {
          "app/store.py": [
            "class Store:",
            "    def mcp_endpoint(self) -> str:",
            '        return f"https://{self.domain}/api/mcp"',
          ],
          "app/agent.py": [
            "from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPServerParams",
            "from .store import Store",
            "",
            "def tools(store: Store):",
            "    return StreamableHTTPServerParams(url=store.mcp_endpoint())",
          ],
        },
        "app/agent.py",
      );
      expect(findings).toEqual([]);
    });
  });

  describe("LiteLLM model prefixes", () => {
    it("names the provider of a literal model and of every value in a model table", () => {
      const findings = outbound([
        "import litellm",
        "from litellm import completion",
        "",
        "MODELS = {",
        '    "cheap": "together_ai/meta-llama/Llama-3.3-70B-Instruct-Turbo",',
        '    "fast": "groq/llama-3.1-8b-instant",',
        "}",
        "",
        "async def classify(text, tier):",
        "    return await litellm.acompletion(",
        "        model=MODELS[tier],",
        '        messages=[{"role": "user", "content": text}],',
        "    )",
        "",
        "def summarize(text):",
        '    return completion(model="anthropic/claude-sonnet-4", messages=[])',
      ]);
      expect(services(findings)).toEqual(["anthropic", "groq", "together_ai"]);
      expect(findings.filter((f) => f.properties.serviceName === "groq").map(span)).toEqual(["10-13"]);
    });

    it("ignores models without a known provider prefix", () => {
      const findings = outbound([
        "import litellm",
        'litellm.completion(model="gpt-4o-mini", messages=[])',
        'litellm.completion(model="someone/custom-model", messages=[])',
      ]);
      expect(services(findings)).toEqual([]);
    });
  });

  describe("Phoenix package", () => {
    it("names Arize Phoenix for phoenix.otel calls with a configured endpoint", () => {
      const findings = outbound([
        "from opentelemetry.sdk.trace import TracerProvider",
        "import phoenix.otel",
        "from .settings import settings",
        "",
        "def install():",
        "    provider = TracerProvider()",
        "    provider.add_span_processor(phoenix.otel.BatchSpanProcessor(endpoint=settings.TRACES_ENDPOINT))",
      ]);
      expect(services(findings)).toEqual(["arize_phoenix"]);
      expect(findings.map((f) => f.location.startLine).sort((a, b) => a - b)).toEqual([2, 7]);
    });
  });

  describe("kwargs builders", () => {
    const config = [
      "import os",
      "from typing import cast",
      "from pydantic import TypeAdapter",
      "",
      "class Config:",
      '    PRIMARY_MODEL = TypeAdapter(str).validate_python(os.getenv("PRIMARY_MODEL", "cerebras/qwen-3-32b"))',
      "    GATEWAY_BASE_URL = TypeAdapter(str).validate_python(",
      '        os.getenv("GATEWAY_BASE_URL", "https://openrouter.ai/api/v1")',
      "    )",
      '    GATEWAY_MODEL = cast(str, os.getenv("GATEWAY_MODEL", "groq/llama-3.1-8b-instant"))',
      '    FALLBACK_MODEL = str(os.getenv("FALLBACK_MODEL", "together_ai/meta-llama/Llama-3.3-70B"))',
    ];

    it("reads model and api_base from a merged kwargs dict; the api_base host wins", () => {
      const findings = outboundInRepo(
        {
          "app/config.py": config,
          "app/llm.py": [
            "import litellm",
            "from .config import Config",
            "",
            "def gateway_kwargs() -> dict:",
            '    return {"model": Config.GATEWAY_MODEL, "api_base": Config.GATEWAY_BASE_URL}',
            "",
            "async def complete(messages, **overrides):",
            "    kwargs = {**gateway_kwargs(), **overrides}",
            "    return await litellm.acompletion(messages=messages, **kwargs)",
            "",
            "async def fallback(messages):",
            '    params = {"model": Config.FALLBACK_MODEL}',
            "    return await litellm.acompletion(messages=messages, **params)",
          ],
        },
        "app/llm.py",
      );
      // groq/ prefix, but the request goes to the openrouter.ai api_base.
      expect(findings.filter((f) => f.location.startLine === 9).map((f) => f.properties.serviceName)).toEqual(["openrouter"]);
      expect(findings.filter((f) => f.location.startLine === 13).map((f) => f.properties.serviceName)).toEqual(["together_ai"]);
    });

    it("routes Google ADK LiteLlm(model=...) by prefix through a validator-wrapped default", () => {
      const findings = outboundInRepo(
        {
          "app/config.py": config,
          "app/agent.py": [
            "from google.adk.models.lite_llm import LiteLlm",
            "from .config import Config",
            "",
            "def agent_model() -> LiteLlm:",
            "    return LiteLlm(model=Config.PRIMARY_MODEL)",
          ],
        },
        "app/agent.py",
      );
      expect(services(findings)).toEqual(["cerebras"]);
      expect(findings[0].location.startLine).toBe(5);
    });

    it("keeps os.getenv defaults through cast(...) and str(...)", () => {
      const findings = outbound([
        "import os",
        "from typing import cast",
        "import httpx",
        'A = cast(str, os.getenv("A_URL", "https://api.telegram.org"))',
        'B = str(os.environ.get("B_URL", "https://api.crisp.chat/v1"))',
        "httpx.get(A)",
        "httpx.get(B)",
      ]);
      expect(services(findings)).toEqual(["crisp", "telegram"]);
    });

    it("attributes MCP params built in a helper's **params dict to the helper's caller", () => {
      const findings = outbound(
        [
          "from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPServerParams",
          "from google.adk.tools.mcp_tool.mcp_toolset import McpToolset",
          "",
          "def _connection(url: str, timeout: float) -> StreamableHTTPServerParams:",
          '    params = {"url": url, "timeout": timeout}',
          "    return StreamableHTTPServerParams(**params)",
          "",
          "class ShopifyCatalogTools:",
          "    def __init__(self, shop: str, url_override: str | None = None) -> None:",
          '        endpoint = url_override or f"https://{shop}/api/mcp"',
          "        self.toolset = McpToolset(connection_params=_connection(url=endpoint, timeout=20))",
        ],
        "tools/store_tools.py",
      );
      expect(services(findings)).toEqual(["shopify"]);
      expect(findings.map((f) => f.location.startLine).sort((a, b) => a - b)).toEqual([6, 11]);
    });
  });

  describe("pass-through wrappers", () => {
    const providers = [
      "import os",
      'BACKEND = os.getenv("LLM_BACKEND", "gateway")',
      'GATEWAY_URL = os.getenv("GATEWAY_URL", "https://openrouter.ai/api/v1")',
      'DIRECT_URL = os.getenv("DIRECT_URL", "https://api.cerebras.ai/v1")',
      'MODEL = os.getenv("LLM_MODEL", "gpt-oss-120b")',
      "",
      "def completion_kwargs() -> dict:",
      '    if BACKEND == "gateway":',
      '        return {"model": f"openrouter/openai/{MODEL}", "api_base": GATEWAY_URL}',
      '    return {"model": f"cerebras/{MODEL}", "api_base": DIRECT_URL}',
    ];
    const client = [
      "import litellm",
      "",
      "async def call_model(**kwargs):",
      "    try:",
      "        return await litellm.acompletion(**kwargs)",
      "    except litellm.exceptions.RateLimitError:",
      '        return await litellm.acompletion(**{**kwargs, "num_retries": 2})',
    ];

    it("resolves every return branch of a kwargs helper passed through an imported wrapper, at the caller", () => {
      const findings = outboundInRepo(
        {
          "app/providers.py": providers,
          "app/llm_client.py": client,
          "app/triage.py": [
            "from .llm_client import call_model",
            "from .providers import completion_kwargs",
            "",
            "async def triage(text: str) -> str:",
            "    response = await call_model(",
            "        **completion_kwargs(),",
            "        temperature=0,",
            '        messages=[{"role": "user", "content": text}],',
            "    )",
            "    return response",
          ],
        },
        "app/triage.py",
      );
      expect(services(findings)).toEqual(["cerebras", "openrouter"]);
      expect([...new Set(findings.map(span))]).toEqual(["5-9"]);
    });

    it("reports nothing at the caller when the wrapper's arguments do not resolve", () => {
      const findings = outboundInRepo(
        {
          "app/llm_client.py": client,
          "app/use.py": ["from .llm_client import call_model", "", "async def go(model):", "    return await call_model(model=model, messages=[])"],
        },
        "app/use.py",
      );
      expect(findings).toEqual([]);
    });

    it("follows named wrapper parameters into an HTTP call", () => {
      const findings = outboundInRepo(
        {
          "app/http_util.py": ["import httpx", "", "def fetch(url: str, **kw):", "    return httpx.get(url, **kw)"],
          "app/notify.py": [
            "from .http_util import fetch",
            'TELEGRAM = "https://api.telegram.org"',
            "",
            "def ping():",
            '    return fetch(f"{TELEGRAM}/bot1/getMe", timeout=5)',
          ],
        },
        "app/notify.py",
      );
      expect(services(findings)).toEqual(["telegram"]);
      expect(findings[0].location.startLine).toBe(5);
    });

    it("keeps {**helper(), extra} merges for ADK LiteLlm(**model_kwargs)", () => {
      const findings = outboundInRepo(
        {
          "app/providers.py": providers,
          "app/agent.py": [
            "from google.adk.models.lite_llm import LiteLlm",
            "from .providers import completion_kwargs",
            "",
            "def agent_model() -> LiteLlm:",
            '    model_kwargs = {**completion_kwargs(), "temperature": 0}',
            "    return LiteLlm(**model_kwargs)",
          ],
        },
        "app/agent.py",
      );
      expect(services(findings)).toEqual(["cerebras", "openrouter"]);
      expect([...new Set(findings.map(span))]).toEqual(["6-6"]);
    });
  });

  describe("Google API clients and vendor names", () => {
    it("routes googleapiclient build() calls imported inside function bodies", () => {
      const file = pythonFile(
        [
          "def send(credentials, raw):",
          "    from googleapiclient.discovery import build",
          '    gmail = build("gmail", "v1", credentials=credentials)',
          '    gmail.users().messages().send(userId="me", body={"raw": raw}).execute()',
          "",
          "def store(credentials):",
          "    from googleapiclient import discovery",
          '    drive = discovery.build("drive", "v3", credentials=credentials)',
          '    sheets = discovery.build(serviceName="sheets", version="v4", credentials=credentials)',
          '    calendar = discovery.build("calendar", "v3", credentials=credentials)',
          '    docs = discovery.build("docs", "v1", credentials=credentials)',
          '    other = discovery.build("youtube", "v3", credentials=credentials)',
        ],
        "app/workspace.py",
      );
      const all = detectPythonPatterns(file);
      // The line parser keeps indented imports too.
      expect(all.length).toBeGreaterThan(0);
      const findings = all.filter((f) => f.pattern === "external_api_call");
      expect(services(findings)).toEqual(["gmail", "google_calendar", "google_docs", "google_drive", "google_sheets"]);
      expect(findings.find((f) => f.properties.serviceName === "gmail")?.location.startLine).toBe(3);
      const subtypes = Object.fromEntries(
        dedupeComponents(classifyRawFindings(findings)).map((c) => [componentScannerIdentityKey(c), c.subType]),
      );
      expect(subtypes["third_party:gmail"]).toBe("email_provider");
      expect(subtypes["third_party:google_drive"]).toBe("saas_service");
    });

    it("names catalog vendors whose host differs from their name", () => {
      const findings = outbound([
        "import httpx",
        'httpx.post("https://api.perplexity.ai/chat/completions")',
        'httpx.post("https://api.firecrawl.dev/v1/scrape")',
        'httpx.post("https://tavusapi.com/v2/conversations")',
        'httpx.post("https://discord.com/api/webhooks/1/abc")',
        'httpx.get("https://api.dramaboxdb.com/v1/titles")',
      ]);
      expect(services(findings)).toEqual(["discord", "dramaboxdb", "firecrawl", "perplexity", "tavus"]);
    });

    it("names every Instagram host instagram, as one component", () => {
      const findings = outbound([
        "import httpx",
        'httpx.get("https://graph.instagram.com/v21.0/me")',
        'httpx.get("https://api.instagram.com/oauth/access_token")',
        'httpx.get("https://www.instagram.com/p/abc/")',
      ]);
      expect(services(findings)).toEqual(["instagram"]);
      const components = dedupeComponents(classifyRawFindings(findings)).filter((c) => c.type === "third_party");
      expect(components.map((c) => componentScannerIdentityKey(c))).toEqual(["third_party:instagram"]);
    });
  });

  describe("organization domains", () => {
    it("keeps a call to the organization's own host as a first-party API component", () => {
      const findings = runWithOrganizationDomainsScope(["acme.io"], () =>
        outbound(["import httpx", "", "def sync(body):", '    return httpx.post("https://api.acme.io/v1/sync", json=body)']),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0].properties).toMatchObject({ firstParty: true, host: "api.acme.io", httpClientLibrary: "httpx" });
      expect(findings[0].properties.serviceName).toBeUndefined();
      const components = dedupeComponents(classifyRawFindings(findings, { organizationDomains: ["acme.io"] }));
      expect(components).toHaveLength(1);
      expect(components[0]).toMatchObject({ type: "asset", subType: "api" });
    });
  });

  describe("platform hosts, declared domains, outgoing auth headers", () => {
    it("names no vendor for Cloud Run and other platform hosts", () => {
      const findings = outbound([
        "import httpx",
        'httpx.post("https://svc-123.europe-west1.run.app/chat")',
        'httpx.get("https://abc123.execute-api.eu-west-1.amazonaws.com/prod/items")',
        'httpx.get("https://my-app.herokuapp.com/health")',
      ]);
      expect(services(findings)).toEqual([]);
      expect(findings.map((f) => f.properties.platform)).toEqual(["gcp/cloud_run", "aws/api_gateway", "heroku"]);
      expect(classifyRawFindings(findings).every((c) => c.type === "asset" && c.subType === "api")).toBe(true);
    });

    it("uses site URL settings as organization domains only when none are configured", () => {
      const repo = {
        ".env.example": ["NEXT_PUBLIC_SITE_URL=https://www.acme-learning.com", "STRIPE_API_URL=https://api.stripe.com"],
        "app/client.py": ["import httpx", 'httpx.get("https://api.acme-learning.com/v1/courses")', 'httpx.get("https://api.stripe.com/v1/charges")'],
      };
      const infos = Object.entries(repo).map(([path, lines]) => pythonFile(lines, path));
      infos[0] = { ...infos[0], language: "env" };
      const detect = () =>
        runWithPythonModuleIndex(infos, () => detectPythonPatterns(infos[1]).filter((f) => f.pattern === "external_api_call"));
      const inferred = detect();
      expect(inferred.map((f) => f.properties.firstParty ?? f.properties.serviceName)).toEqual([true, "stripe"]);
      // Configured organization domains take precedence over declared ones.
      const configured = runWithOrganizationDomainsScope(["other.io"], detect);
      expect(configured.map((f) => f.properties.serviceName)).toEqual(["acme-learning", "stripe"]);
    });

    it("does not report Authorization headers sent on outbound requests as an auth service", () => {
      const findings = detectPythonPatterns(
        pythonFile([
          "import httpx",
          "",
          "async def send(token, body):",
          '    headers = {"Authorization": f"Bearer {token}"}',
          "    async with httpx.AsyncClient() as client:",
          '        await client.post("https://api.x.com/2/tweets", json=body, headers=headers)',
          "",
          "def check(request):",
          '    return request.headers.get("Authorization", "").startswith("Bearer ")',
        ]),
      );
      const auth = findings.filter((f) => f.pattern === "auth_middleware");
      expect(auth.map((f) => f.location.startLine)).toEqual([9]);
    });

    it("does not treat instrumentation packages as calls to the vendor", () => {
      const findings = outbound(["from openinference.instrumentation.openai import OpenAIInstrumentor", "OpenAIInstrumentor().instrument()"]);
      expect(services(findings)).toEqual([]);
    });
  });

  describe("git remote owner and platform display names", () => {
    const client = ["import httpx", 'httpx.get("https://api.acmewidgets.ai/v1/courses")'];
    const detectWithOwner = (owner: string | undefined, orgDomains?: string[]) => {
      const infos = [pythonFile(client, "app/client.py")];
      const run = () =>
        runWithPythonModuleIndex(infos, () => detectPythonPatterns(infos[0]).filter((f) => f.pattern === "external_api_call"), {
          gitRemoteOwner: owner,
        });
      return orgDomains ? runWithOrganizationDomainsScope(orgDomains, run) : run();
    };

    it("marks a host whose domain label matches the git remote owner as first-party", () => {
      const findings = detectWithOwner("Acme-Widgets-AI");
      expect(findings[0].properties).toMatchObject({ firstParty: true, host: "api.acmewidgets.ai" });
      expect(findings[0].properties.serviceName).toBeUndefined();
    });

    it("keeps the vendor name on a near miss, with no remote, or when organization domains are configured", () => {
      expect(detectWithOwner("acme-widget")[0].properties.serviceName).toBe("acmewidgets");
      expect(detectWithOwner(undefined)[0].properties.serviceName).toBe("acmewidgets");
      expect(detectWithOwner("Acme-Widgets-AI", ["other.io"])[0].properties.serviceName).toBe("acmewidgets");
    });

    it("never turns a catalog vendor host first-party because of the owner name", () => {
      const infos = [pythonFile(["import httpx", 'httpx.get("https://api.stripe.com/v1/charges")'], "app/pay.py")];
      const findings = runWithPythonModuleIndex(infos, () => detectPythonPatterns(infos[0]).filter((f) => f.pattern === "external_api_call"), {
        gitRemoteOwner: "stripe",
      });
      expect(findings[0].properties.serviceName).toBe("stripe");
    });

    it("reads the origin owner from a git config, including worktrees", () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "owner-"));
      fs.mkdirSync(path.join(root, "repo/.git"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "repo/.git/config"),
        '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/someone/fork.git\n[remote "origin"]\n\turl = git@github.com:Acme-Widgets-AI/site.git\n',
      );
      fs.mkdirSync(path.join(root, "repo/web/src"), { recursive: true });
      expect(readGitRemoteOwner(path.join(root, "repo/web/src"))).toBe("Acme-Widgets-AI");
      fs.mkdirSync(path.join(root, "repo/.git/worktrees/wt"), { recursive: true });
      fs.writeFileSync(path.join(root, "repo/.git/worktrees/wt/commondir"), "../..\n");
      fs.mkdirSync(path.join(root, "wt"));
      fs.writeFileSync(path.join(root, "wt/.git"), `gitdir: ${path.join(root, "repo/.git/worktrees/wt")}\n`);
      expect(readGitRemoteOwner(path.join(root, "wt"))).toBe("Acme-Widgets-AI");
      expect(readGitRemoteOwner(fs.mkdtempSync(path.join(os.tmpdir(), "no-git-")))).toBeUndefined();
      expect(ownerFromRemoteUrl("https://gitlab.com/group/sub/project")).toBe("sub");
      expect(normalizeOrganizationName("Acme-Widgets-AI")).toBe("acmewidgets");
      expect(normalizeOrganizationName("DataParade-io")).toBe("dataparade");
      expect(normalizeOrganizationName("io")).toBe("io");
    });

    it("names platform-hosted services after the service label and platform", () => {
      expect(platformServiceDisplayName("mom-skipify-328574824807.us-central1.run.app")).toBe("mom-skipify (Cloud Run)");
      expect(platformServiceDisplayName("checkout-abcd1234ef-uc.a.run.app")).toBe("checkout (Cloud Run)");
      expect(platformServiceDisplayName("my-app-1a2b3c4d5e6f.herokuapp.com")).toBe("my-app (Heroku)");
      expect(platformServiceDisplayName("shop-web.vercel.app")).toBe("shop-web (Vercel)");
      expect(platformServiceDisplayName("api.acme.com")).toBeUndefined();
      const findings = outbound(["import httpx", 'httpx.post("https://mom-skipify-328574824807.us-central1.run.app/chat")']);
      expect(findings[0].name).toBe("mom-skipify (Cloud Run)");
      const components = classifyRawFindings(findings);
      expect(components.map((c) => c.name)).toEqual(["mom-skipify (Cloud Run)"]);
    });
  });
});
