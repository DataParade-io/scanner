import type { FileInfo } from "../../../../src/core/types/file";
import type { RawFinding } from "../../../../src/core/types/detection";
import { detectPatterns } from "../../../../src/analyzers/typescript/detector";
import { classifyRawFindings, dedupeComponents } from "../../../../src/classifier/classify";
import { runWithPythonModuleIndex } from "../../../../src/patterns/detectors/source-module-index";
import { runWithOrganizationDomainsScope } from "../../../../src/classifier/organization-domains-scan-scope";

/** DATAP-818: TypeScript/JavaScript raw-HTTP destinations, parity with the Python detector. */

const LIBRARIES = ["axios", "fetch", "got", "ky", "node-fetch", "node_fetch"];

function tsFile(lines: string[], path = "src/app.ts"): FileInfo {
  const content = lines.join("\n");
  return { path, name: path.split("/").pop()!, content, language: "typescript", size: content.length };
}

function outbound(lines: string[], path?: string): RawFinding[] {
  return detectPatterns(tsFile(lines, path)).filter((f) => f.pattern === "external_api_call");
}

function outboundInRepo(files: Record<string, string[]>, target: string): RawFinding[] {
  const infos = Object.entries(files).map(([path, lines]) => tsFile(lines, path));
  const file = infos.find((f) => f.path === target)!;
  return runWithPythonModuleIndex(infos, () => detectPatterns(file).filter((f) => f.pattern === "external_api_call"));
}

function services(findings: RawFinding[]): string[] {
  return [...new Set(findings.map((f) => f.properties.serviceName).filter((s): s is string => typeof s === "string"))].sort();
}

function expectNoLibraryDestination(findings: RawFinding[]): void {
  for (const f of findings) {
    expect(LIBRARIES).not.toContain(String(f.properties.serviceName ?? "").toLowerCase());
    expect(f.name).not.toMatch(/^(axios|fetch|got|ky)_call$/);
  }
  for (const c of classifyRawFindings(findings)) {
    expect(LIBRARIES).not.toContain(c.name.toLowerCase());
  }
}

describe("typescript outbound HTTP destinations (DATAP-818)", () => {
  it("names the vendor of a literal fetch URL across the whole call", () => {
    const findings = outbound([
      "export async function chat(messages: unknown[]) {",
      '  return fetch("https://api.mistral.ai/v1/chat/completions", {',
      '    method: "POST",',
      "    body: JSON.stringify({ messages }),",
      "  });",
      "}",
    ]);
    expect(services(findings)).toEqual(["mistral"]);
    expect(findings).toHaveLength(1);
    expect(findings[0].location).toMatchObject({ startLine: 2, endLine: 5 });
  });

  it("resolves a template literal whose base is a parameter defaulting to a module constant", () => {
    const findings = outbound([
      'import axios from "axios";',
      'const DEFAULT_API_BASE = "https://api.airtable.com/v0";',
      "export async function save(email: string, apiBase: string = DEFAULT_API_BASE) {",
      "  return axios.post(`${apiBase}/${process.env.BASE_ID}/Signups`, { email });",
      "}",
    ]);
    expect(services(findings)).toEqual(["airtable"]);
    expectNoLibraryDestination(findings);
  });

  it("joins relative paths with an axios.create / got.extend base URL", () => {
    const findings = outbound([
      'import axios from "axios";',
      'import got from "got";',
      'const crm = axios.create({ baseURL: "https://api.hubapi.com" });',
      'const discord = got.extend({ prefixUrl: "https://discord.com/api" });',
      "export async function sync(email: string) {",
      '  await crm.post("/crm/v3/objects/contacts", { properties: { email } });',
      '  await discord.post("webhooks/1/abc", { json: { content: email } });',
      "}",
    ]);
    expect(services(findings)).toEqual(["discord", "hubspot"]);
    expect(findings.find((f) => f.properties.serviceName === "hubspot")?.location.startLine).toBe(6);
    expectNoLibraryDestination(findings);
  });

  it("follows a URL constant imported from a same-repo module with an env default", () => {
    const findings = outboundInRepo(
      {
        "src/settings.ts": [
          "export const ALERTS_WEBHOOK_URL =",
          '  process.env.ALERTS_WEBHOOK_URL ?? "https://hooks.slack.com/services/x/y/z";',
        ],
        "src/notify.ts": [
          'import { ALERTS_WEBHOOK_URL } from "./settings";',
          "export async function notify(text: string) {",
          '  await fetch(ALERTS_WEBHOOK_URL, { method: "POST", body: JSON.stringify({ text }) });',
          "}",
        ],
      },
      "src/notify.ts",
    );
    expect(services(findings)).toEqual(["slack"]);
  });

  it("reports env-only bases as an outbound call with no vendor", () => {
    const findings = outbound([
      'import axios from "axios";',
      "const orders = axios.create({ baseURL: import.meta.env.VITE_ORDERS_API_URL });",
      "export async function place(cartId: string) {",
      '  return orders.post("/orders", { cartId });',
      "}",
      "export async function legacy() {",
      "  return fetch(process.env.LEGACY_API_URL!);",
      "}",
    ]);
    expect(findings.map((f) => f.name)).toEqual(["outbound_http_call", "outbound_http_call"]);
    expect(findings.map((f) => f.location.startLine)).toEqual([4, 7]);
    for (const f of findings) expect(f.properties.serviceName).toBeUndefined();
    expectNoLibraryDestination(findings);
    expect(classifyRawFindings(findings).every((c) => c.type !== "third_party")).toBe(true);
  });

  it("does not report same-origin relative calls or library imports alone", () => {
    const findings = outbound([
      'import axios from "axios";',
      'import ky from "ky";',
      "export async function me() {",
      '  await fetch("/api/me");',
      '  return axios.get("/api/session");',
      "}",
    ]);
    expect(findings).toEqual([]);
  });

  it("uses named request functions from node-fetch/undici and require()", () => {
    const findings = outbound(
      [
        'const axios = require("axios");',
        'const { request } = require("undici");',
        'import { fetch as undiciFetch } from "undici";',
        "async function go() {",
        '  await axios("https://api.perplexity.ai/chat/completions");',
        '  await undiciFetch("https://api.firecrawl.dev/v1/scrape");',
        "}",
      ],
      "src/tools.js",
    );
    expect(services(findings)).toEqual(["firecrawl", "perplexity"]);
  });

  it("keeps a call to the organization's own host as a first-party API, not a third party", () => {
    const findings = runWithOrganizationDomainsScope(["acme.io"], () =>
      outbound(['export const load = () => fetch("https://api.acme.io/v1/orders");']),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].properties).toMatchObject({ firstParty: true, host: "api.acme.io" });
    expect(findings[0].properties.serviceName).toBeUndefined();
    const components = dedupeComponents(classifyRawFindings(findings, { organizationDomains: ["acme.io"] }));
    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({ type: "asset", subType: "api" });
  });
});
