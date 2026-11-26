import type { FileInfo } from "../../../../src/core/types/file";
import type { RawFinding } from "../../../../src/core/types/detection";
import { detectPythonPatterns } from "../../../../src/analyzers/python/detector";
import { classifyRawFindings, dedupeComponents } from "../../../../src/classifier/classify";
import { componentScannerIdentityKey } from "../../../../src/eval/canonical/scanner/components";

/**
 * Shopify Storefront and Admin APIs on a merchant's own domain, and the Slack and Voyage AI
 * SDKs (DATAP-789 misses: raw HTTP to a runtime host, and SDKs with no mapping).
 */

function pythonFile(lines: string[], path: string): FileInfo {
  const content = lines.join("\n");
  return { path, name: path, content, language: "python", size: content.length };
}

function findings(lines: string[], path: string): RawFinding[] {
  return detectPythonPatterns(pythonFile(lines, path));
}

function outboundServices(lines: string[], path: string): string[] {
  return [
    ...new Set(
      findings(lines, path)
        .filter((f) => f.pattern === "external_api_call")
        .map((f) => f.properties.serviceName)
        .filter((s): s is string => typeof s === "string"),
    ),
  ].sort();
}

function thirdParties(lines: string[], path: string): string[] {
  return dedupeComponents(classifyRawFindings(findings(lines, path)))
    .filter((c) => c.type === "third_party")
    .map((c) => `${componentScannerIdentityKey(c)}/${c.subType}`)
    .sort();
}

describe("Shopify APIs on the merchant's domain", () => {
  it("names Storefront GraphQL on a runtime host in Shopify code", () => {
    const lines = [
      "import httpx",
      "",
      "class ShopifyCatalog:",
      "    def __init__(self, domain: str, token: str, api_version: str = '2025-01'):",
      "        self.domain = domain",
      "        self.token = token",
      "        self.api_version = api_version",
      "",
      "    async def query(self, document: str, variables: dict):",
      '        url = f"https://{self.domain}/api/{self.api_version}/graphql.json"',
      "        async with httpx.AsyncClient(timeout=10) as client:",
      "            resp = await client.post(url, json={'query': document, 'variables': variables})",
      "        return resp.json()",
    ];
    expect(outboundServices(lines, "store/catalog.py")).toEqual(["shopify"]);
  });

  it("names the Admin OAuth token exchange and Admin REST calls", () => {
    const lines = [
      "import httpx",
      "",
      "async def exchange_code(shop: str, code: str, client_id: str, secret: str):",
      "    async with httpx.AsyncClient() as client:",
      "        return await client.post(",
      '            f"https://{shop}/admin/oauth/access_token",',
      "            json={'client_id': client_id, 'client_secret': secret, 'code': code},",
      "        )",
      "",
      "async def find_customer(shop: str, token: str, email: str):",
      "    async with httpx.AsyncClient() as client:",
      "        return await client.get(",
      '            f"https://{shop}/admin/api/2025-01/customers/search.json",',
      "            params={'query': f'email:{email}'},",
      "            headers={'X-Shopify-Access-Token': token},",
      "        )",
    ];
    expect(outboundServices(lines, "integrations/shopify_admin.py")).toEqual(["shopify"]);
  });

  it("names the public products.json catalogue in Shopify code", () => {
    const lines = [
      "import httpx",
      "",
      "async def first_product(domain: str):",
      "    async with httpx.AsyncClient(timeout=10) as client:",
      '        return await client.get(f"https://{domain}/products.json?limit=1")',
    ];
    expect(outboundServices(lines, "tools/shopify_tools.py")).toEqual(["shopify"]);
  });

  it("does not name Shopify for the same paths outside Shopify code", () => {
    const lines = [
      "import httpx",
      "",
      "async def first_product(domain: str):",
      "    async with httpx.AsyncClient(timeout=10) as client:",
      '        await client.get(f"https://{domain}/products.json?limit=1")',
      '        await client.post(f"https://{domain}/api/v2/graphql.json", json={})',
    ];
    expect(outboundServices(lines, "tools/catalog_client.py")).toEqual([]);
  });
});

describe("Slack and Voyage AI SDKs", () => {
  it("maps slack_bolt and slack_sdk imports to Slack", () => {
    const lines = [
      "from slack_bolt.async_app import AsyncApp",
      "from slack_sdk.web.async_client import AsyncWebClient",
      "",
      "app = AsyncApp(token='x')",
    ];
    expect(thirdParties(lines, "bots/slack_bot.py")).toEqual(["third_party:slack/messaging"]);
  });

  it("maps the voyageai import to Voyage AI", () => {
    const lines = [
      "import voyageai",
      "",
      "def embed(texts: list[str]) -> list[list[float]]:",
      "    client = voyageai.Client()",
      "    return client.embed(texts, model='voyage-3').embeddings",
    ];
    expect(thirdParties(lines, "search/embeddings.py")).toEqual(["third_party:voyage_ai/ai_provider"]);
  });
});
