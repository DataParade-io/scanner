import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import type { RawFinding } from "../../../src/core/types/detection";
import {
  completeFlowInteractionDescriptions,
  describeFlowFromFinding,
  flowInteractionLabel,
} from "../../../src/data-flow/flow-interaction-description";

function makeComponent(
  overrides: Partial<DetectedComponent> & Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return {
    confidence: 0.9,
    detectedFrom: [],
    sourceLocations: [],
    properties: {},
    ...overrides,
  };
}

function makeFinding(overrides: Partial<RawFinding> & Pick<RawFinding, "pattern">): RawFinding {
  return {
    name: "finding",
    confidence: 0.8,
    location: { filePath: "src/app.ts", startLine: 10, endLine: 10 },
    properties: {},
    ...overrides,
  };
}

function makeFlow(overrides: Partial<DetectedDataFlow>): DetectedDataFlow {
  return {
    id: "flow_1",
    sourceComponentId: "app",
    targetComponentId: "target",
    type: "api_call",
    confidence: 0.8,
    ...overrides,
  };
}

const application = makeComponent({ id: "app", name: "backend", type: "asset", subType: "service" });
const stripe = makeComponent({ id: "stripe", name: "Stripe", type: "third_party" });
const customer = makeComponent({ id: "customer", name: "Customer", type: "actor", subType: "customer" });
const postgresDatabase = makeComponent({
  id: "db",
  name: "Postgres",
  type: "asset",
  subType: "database",
  properties: { databaseType: "postgres" },
});

describe("describeFlowFromFinding", () => {
  it("names the vendor SDK for an outbound call made without an HTTP client library", () => {
    const finding = makeFinding({
      pattern: "external_api_call",
      properties: { serviceName: "stripe", client: "stripe", sdkPackage: "stripe", api_type: "rest" },
    });
    expect(describeFlowFromFinding(finding, "api_call", application, stripe)).toEqual({
      relationship: "invokes",
      protocol: "vendor_sdk",
      transport: undefined,
      client: "stripe",
    });
  });

  it("names the SDK package, not the scanned project's own package, as the client", () => {
    const finding = makeFinding({
      pattern: "external_api_call",
      properties: { serviceName: "sendgrid", client: "sendgrid", sdkPackage: "@sendgrid/mail", package_name: "fx1" },
    });
    expect(describeFlowFromFinding(finding, "api_call", application, stripe).client).toBe("@sendgrid/mail");
    const withoutImport = makeFinding({
      pattern: "external_api_call",
      properties: { serviceName: "stripe", client: "stripe", package_name: "fx1" },
    });
    expect(describeFlowFromFinding(withoutImport, "api_call", application, stripe).client).toBe("stripe");
  });

  it("does not call an internal fetch REST from its path alone", () => {
    const finding = makeFinding({
      pattern: "express_route",
      name: "INTERNAL_FETCH /api/users",
      properties: { httpMethod: "GET", url: "/api/users" },
    });
    const description = describeFlowFromFinding(finding, "api_call", application, application);
    expect(description).toEqual({ relationship: "invokes", protocol: "unknown", transport: undefined, client: "fetch" });
    expect(flowInteractionLabel(makeFlow(description))).toBe("HTTP request");
    const graphql = makeFinding({ pattern: "express_route", name: "INTERNAL_FETCH /graphql", properties: { url: "/graphql" } });
    expect(describeFlowFromFinding(graphql, "api_call", application, application).protocol).toBe("graphql");
  });

  it("does not treat the blanket api_type default as evidence of REST", () => {
    const finding = makeFinding({
      pattern: "external_api_call",
      properties: { serviceName: "aws", client: "aws", api_type: "rest" },
    });
    expect(describeFlowFromFinding(finding, "api_call", application, stripe).protocol).toBe(
      "vendor_sdk",
    );
  });

  it("records the HTTP client and the URL scheme for a fetch call", () => {
    const finding = makeFinding({
      pattern: "external_api_call",
      properties: { client: "fetch", httpClientLibrary: "fetch", url: "https://api.example.com/v1" },
    });
    expect(describeFlowFromFinding(finding, "api_call", application, stripe)).toEqual({
      relationship: "invokes",
      protocol: undefined,
      transport: "https",
      client: "fetch",
    });
  });

  it("recognises GraphQL from the URL", () => {
    const finding = makeFinding({
      pattern: "external_api_call",
      properties: { client: "fetch", httpClientLibrary: "fetch", url: "https://api.github.com/graphql" },
    });
    expect(describeFlowFromFinding(finding, "api_call", application, stripe).protocol).toBe("graphql");
  });

  it("recognises MCP from the detector's transport property", () => {
    const finding = makeFinding({
      pattern: "external_api_call",
      properties: { serviceName: "shopify", transport: "mcp_http", url: "https://shop.example.com/api/mcp" },
    });
    expect(describeFlowFromFinding(finding, "api_call", application, stripe)).toMatchObject({
      relationship: "invokes",
      protocol: "mcp",
      transport: "https",
    });
  });

  it("marks a database connection as an SQL query when the engine is relational", () => {
    const finding = makeFinding({ pattern: "database_connection", properties: { client: "typeorm" } });
    expect(describeFlowFromFinding(finding, "database_query", application, postgresDatabase)).toEqual({
      relationship: "queries",
      protocol: "sql",
      client: "typeorm",
    });
  });

  it("marks auth middleware as authenticates_via", () => {
    const finding = makeFinding({ pattern: "auth_middleware" });
    expect(describeFlowFromFinding(finding, "api_call", application, stripe)).toEqual({
      relationship: "authenticates_via",
    });
  });

  it("marks any flow from a human actor as interacts", () => {
    const finding = makeFinding({ pattern: "web_actor" });
    expect(describeFlowFromFinding(finding, "api_call", customer, application)).toEqual({
      relationship: "interacts",
    });
  });
});

describe("completeFlowInteractionDescriptions", () => {
  const components = [application, stripe, customer, postgresDatabase];

  it("keeps a relationship that was already set", () => {
    const flows = [makeFlow({ relationship: "uses_in_process" })];
    completeFlowInteractionDescriptions(flows, components);
    expect(flows[0].relationship).toBe("uses_in_process");
    expect(flows[0].transport).toBe("in_process");
  });

  it("marks an api_call flow with no code evidence as depends_on", () => {
    const flows = [makeFlow({})];
    completeFlowInteractionDescriptions(flows, components);
    expect(flows[0].relationship).toBe("depends_on");
  });

  it("marks an api_call flow with code evidence as invokes", () => {
    const flows = [
      makeFlow({ sourceLocation: { filePath: "src/app.ts", startLine: 1, endLine: 1 } }),
    ];
    completeFlowInteractionDescriptions(flows, components);
    expect(flows[0].relationship).toBe("invokes");
  });

  it("overrides the relationship of a flow that starts at a human actor", () => {
    const flows = [makeFlow({ sourceComponentId: "customer", relationship: "invokes" })];
    completeFlowInteractionDescriptions(flows, components);
    expect(flows[0].relationship).toBe("interacts");
  });

  it("fills the SQL protocol for a database query from the target's engine", () => {
    const flows = [makeFlow({ type: "database_query", targetComponentId: "db" })];
    completeFlowInteractionDescriptions(flows, components);
    expect(flows[0]).toMatchObject({ relationship: "queries", protocol: "sql" });
  });
});

describe("flowInteractionLabel", () => {
  it.each<[Partial<DetectedDataFlow>, string]>([
    [{ relationship: "uses_in_process" }, "uses"],
    [{ relationship: "exposes" }, "exposes"],
    [{ relationship: "authenticates_via" }, "authenticates via"],
    [{ relationship: "depends_on" }, "depends on"],
    [{ relationship: "provisions" }, "provisions"],
    [{ relationship: "interacts" }, "interacts"],
    [{ relationship: "interacts", channel: "web_gui" }, "Web GUI"],
    [{ relationship: "invokes", protocol: "vendor_sdk", client: "stripe" }, "Vendor SDK"],
    [{ relationship: "invokes", protocol: "vendor_sdk", transport: "https" }, "Vendor SDK · HTTPS"],
    [{ relationship: "invokes", protocol: "rest", transport: "https" }, "REST · HTTPS"],
    [{ relationship: "invokes", protocol: "mcp", transport: "stdio" }, "MCP · stdio"],
    [{ relationship: "invokes", client: "fetch", transport: "https" }, "HTTPS request"],
    [{ relationship: "invokes", client: "axios" }, "HTTP request"],
    [{ relationship: "queries", type: "database_query", protocol: "sql" }, "SQL"],
    [{ relationship: "queries", type: "database_query" }, "database query"],
    [{ relationship: "invokes" }, "api call"],
  ])("labels %j as %s", (flowOverrides, expectedLabel) => {
    expect(flowInteractionLabel(makeFlow(flowOverrides))).toBe(expectedLabel);
  });
});
