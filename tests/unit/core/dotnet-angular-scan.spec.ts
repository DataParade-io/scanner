import path from "path";

import {
  createDefaultScanConfiguration,
  scan,
} from "../../../src/core/pipeline/orchestrator";

function fixturePath(name: string): string {
  return path.join(__dirname, "..", "..", "fixtures", name);
}

describe("ServiceStack and Angular UI scans", () => {
  it("links a ServiceStack client call to the request DTO route", async () => {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult, findings, files } = await scan(
      fixturePath("servicestack-basic"),
      config,
    );

    expect(files.some((file) => file.path.endsWith("dtos.ts"))).toBe(true);

    const routes = findings.filter(
      (finding) =>
        finding.pattern === "express_route" &&
        finding.properties?.framework === "servicestack",
    );
    expect(routes.map((route) => route.name).sort()).toEqual([
      "GET /hello/{Name}",
      "GET /todos",
    ]);
    expect(routes.map((route) => route.properties?.requestType).sort()).toEqual(
      ["Hello", "QueryTodos"],
    );
    expect(
      findings.some(
        (finding) =>
          finding.pattern === "express_route" &&
          String(finding.location?.code ?? "").includes("getMethod"),
      ),
    ).toBe(false);

    const clientFlow = scanResult.dataFlows.find(
      (flow) => flow.targetScopeReason === "servicestack-client-call",
    );
    expect(clientFlow).toBeDefined();
    expect(clientFlow?.endpoint).toBe("/todos");
    expect(clientFlow?.method).toBe("GET");
    const flowSource = scanResult.components.find(
      (component) => component.id === clientFlow?.sourceComponentId,
    );
    expect(flowSource?.subType).toBe("application");
    const flowTarget = scanResult.components.find(
      (component) => component.id === clientFlow?.targetComponentId,
    );
    expect(flowTarget?.subType).toBe("api");

    const adminLocations = scanResult.components
      .filter((component) => component.name.toLowerCase().includes("admin"))
      .flatMap((component) =>
        component.sourceLocations.map((loc) => loc.filePath),
      );
    expect(
      adminLocations.some((filePath) => filePath.endsWith("dtos.ts")),
    ).toBe(false);
  });

  it("keeps the Angular GUI as a caller of the ASP.NET controller", async () => {
    const config = createDefaultScanConfiguration({ enableAiInference: false });
    const { scanResult, findings, files } = await scan(
      fixturePath("angular-dotnet-eventlog"),
      config,
    );

    expect(files.some((file) => file.path.includes("public/lib"))).toBe(false);
    expect(files.some((file) => file.path.includes("Migrations"))).toBe(false);

    const bearerFiles = findings
      .filter(
        (finding) =>
          finding.pattern === "auth_middleware" &&
          finding.properties?.strategy === "bearer_token",
      )
      .map((finding) => finding.location?.filePath ?? "");
    expect(bearerFiles.some((filePath) => filePath.endsWith("server.ts"))).toBe(
      true,
    );
    expect(bearerFiles.some((filePath) => filePath.includes("src/app/"))).toBe(
      false,
    );

    const routes = findings
      .filter((finding) => finding.pattern === "express_route")
      .map((finding) => finding.name);
    expect(routes).toContain("POST api/clienteventlog/log");
    expect(routes.some((name) => name === "Route handler")).toBe(false);

    const databases = findings.filter(
      (finding) => finding.pattern === "database_connection",
    );
    expect(
      databases.map((finding) => finding.properties?.databaseType),
    ).toContain("mssql");
    expect(
      databases.some(
        (finding) => finding.properties?.databaseType === "sqlite",
      ),
    ).toBe(false);

    const frontend = scanResult.components.find(
      (component) =>
        component.properties?.sourceContext === "dependency_manifest",
    );
    expect(frontend?.subType).toBe("application");

    const adminFiles = scanResult.components
      .filter((component) => component.type === "actor")
      .flatMap((component) =>
        component.sourceLocations.map((loc) => loc.filePath),
      );
    expect(adminFiles.some((filePath) => filePath.endsWith("guard.ts"))).toBe(
      true,
    );
    expect(
      adminFiles.some((filePath) => filePath.endsWith("Header.cshtml")),
    ).toBe(false);
    expect(
      adminFiles.some((filePath) => filePath.endsWith("commented.ts")),
    ).toBe(false);
    expect(
      adminFiles.some((filePath) => filePath.endsWith(".component.ts")),
    ).toBe(false);

    const eventFlow = scanResult.dataFlows.find(
      (flow) => flow.endpoint === "/api/clienteventlog/log",
    );
    expect(eventFlow).toBeDefined();
  });
});
