import type { DetectedComponent } from "../../../src/core/types/component";
import type { DetectedDataFlow } from "../../../src/core/types/data-flow";
import type { FileInfo } from "../../../src/core/types/file";
import type { ServiceSection } from "../../../src/core/sectioning/discover-service-sections";
import {
  applyHumanInteractionChannels,
  detectSectionInteractionSurfaces,
  isAiAgentActor,
} from "../../../src/data-flow/human-interaction-channels";

function makeFile(path: string, content: string): FileInfo {
  const name = path.split("/").pop() ?? path;
  return {
    path,
    name,
    content,
    language: name.endsWith(".json") ? "json" : name.endsWith(".py") ? "python" : name.endsWith(".go") ? "go" : "typescript",
    size: content.length,
  };
}

function makeSection(id: string, sectionDir = id): ServiceSection {
  return { id, label: id, role: "service", sectionDir, manifestPaths: [`${sectionDir}/package.json`] };
}

function makeComponent(
  overrides: Partial<DetectedComponent> & Pick<DetectedComponent, "id" | "name" | "type">,
): DetectedComponent {
  return { confidence: 0.9, detectedFrom: [], sourceLocations: [], properties: {}, ...overrides };
}

function makeApplicationHub(id: string, sectionId: string): DetectedComponent {
  return makeComponent({
    id,
    name: sectionId,
    type: "asset",
    subType: "application",
    properties: { section_id: sectionId, isMainApplication: true },
  });
}

function packageJson(manifest: Record<string, unknown>): string {
  return JSON.stringify(manifest, null, 2);
}

describe("detectSectionInteractionSurfaces", () => {
  it("finds a CLI from a package.json bin entry and a commander dependency", () => {
    const surfaces = detectSectionInteractionSurfaces(
      [makeFile("cli/package.json", packageJson({ name: "cli", bin: { tool: "dist/cli.js" }, dependencies: { commander: "^12" } }))],
      [makeSection("cli")],
    );
    expect(surfaces.get("cli")?.evidenceByChannel.get("cli")?.map((evidence) => evidence.signal)).toEqual([
      "package.json bin",
      "dependency commander",
    ]);
  });

  it("finds a web GUI from a Next.js dependency", () => {
    const surfaces = detectSectionInteractionSurfaces(
      [makeFile("frontend/package.json", packageJson({ name: "frontend", scripts: { dev: "next dev" }, dependencies: { next: "15" } }))],
      [makeSection("frontend")],
    );
    expect(surfaces.get("frontend")?.evidenceByChannel.has("web_gui")).toBe(true);
  });

  it("does not treat a library's framework dependency as a web GUI", () => {
    const surfaces = detectSectionInteractionSurfaces(
      [makeFile("packages/utils/package.json", packageJson({ name: "utils", main: "dist/index.js", dependencies: { vue: "3" } }))],
      [makeSection("packages/utils")],
    );
    const surface = surfaces.get("packages/utils");
    expect(surface?.isLibraryPackage).toBe(true);
    expect(surface?.evidenceByChannel.size).toBe(0);
  });

  it("finds an MCP server and its HTTP transport in TypeScript code", () => {
    const surfaces = detectSectionInteractionSurfaces(
      [
        makeFile("backend/package.json", packageJson({ name: "backend", dependencies: { express: "4" } })),
        makeFile(
          "backend/src/mcp.ts",
          'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";\nimport { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";\n',
        ),
      ],
      [makeSection("backend")],
    );
    const surface = surfaces.get("backend");
    expect(surface?.evidenceByChannel.get("mcp")?.[0]).toMatchObject({ filePath: "backend/src/mcp.ts", line: 1 });
    expect(surface?.mcpServerTransport).toBe("http");
    expect(surface?.evidenceByChannel.has("api_direct")).toBe(true);
  });

  it("finds a FastMCP server over stdio in Python code", () => {
    const surfaces = detectSectionInteractionSurfaces(
      [makeFile("tools/server.py", 'from mcp.server.fastmcp import FastMCP\n\nmcp = FastMCP("tools")\nmcp.run(transport="stdio")\n')],
      [makeSection("tools")],
    );
    expect(surfaces.get("tools")?.mcpServerTransport).toBe("stdio");
  });

  it("does not treat a command-line package's framework dependency as a web GUI", () => {
    const surfaces = detectSectionInteractionSurfaces(
      [makeFile("packages/sdk/package.json", packageJson({ name: "sdk", bin: "cli.js", dependencies: { vue: "3" } }))],
      [makeSection("packages/sdk")],
    );
    expect([...(surfaces.get("packages/sdk")?.evidenceByChannel.keys() ?? [])]).toEqual(["cli"]);
  });

  it("reads package manifests nested inside a section", () => {
    const surfaces = detectSectionInteractionSurfaces(
      [makeFile("apps/api/v2/package.json", packageJson({ name: "api", dependencies: { "@nestjs/core": "10" } }))],
      [makeSection("apps/api")],
    );
    expect(surfaces.get("apps/api")?.evidenceByChannel.has("api_direct")).toBe(true);
  });

  it("finds a NestJS API from its bootstrap code and ignores test files", () => {
    const surfaces = detectSectionInteractionSurfaces(
      [
        makeFile("api/src/main.ts", "const app = await NestFactory.create(AppModule);\n"),
        makeFile("api/src/main.spec.ts", 'import { Command } from "commander";\nconst program = new McpServer({});\n'),
      ],
      [makeSection("api")],
    );
    expect([...(surfaces.get("api")?.evidenceByChannel.keys() ?? [])]).toEqual(["api_direct"]);
  });

  it("ignores example apps nested inside a section", () => {
    const surfaces = detectSectionInteractionSurfaces(
      [makeFile("packages/platform/examples/base/package.json", packageJson({ name: "base", dependencies: { next: "15" } }))],
      [makeSection("packages/platform")],
    );
    expect(surfaces.get("packages/platform")?.evidenceByChannel.size).toBe(0);
  });

  it("gives a file to the section with the longest matching directory", () => {
    const surfaces = detectSectionInteractionSurfaces(
      [makeFile("backend/lambdas/handler.go", 'import "github.com/spf13/cobra"\n')],
      [makeSection("backend"), makeSection("backend/lambdas")],
    );
    expect(surfaces.get("backend/lambdas")?.evidenceByChannel.has("cli")).toBe(true);
    expect(surfaces.get("backend")?.evidenceByChannel.has("cli")).toBe(false);
  });
});

describe("applyHumanInteractionChannels", () => {
  const customer = makeComponent({ id: "customer", name: "Customer", type: "actor", subType: "customer", properties: { section_id: "frontend" } });
  const frontend = makeApplicationHub("frontend_app", "frontend");
  const cli = makeApplicationHub("cli_app", "cli");
  const backend = makeApplicationHub("backend_app", "backend");
  const sections = [makeSection("frontend"), makeSection("cli"), makeSection("backend")];
  const files = [
    makeFile("frontend/package.json", packageJson({ name: "frontend", dependencies: { next: "15" } })),
    makeFile("cli/package.json", packageJson({ name: "cli", bin: "dist/cli.js" })),
    makeFile("backend/package.json", packageJson({ name: "backend", dependencies: { "@nestjs/core": "10" } })),
    makeFile("backend/src/mcp.ts", 'const server = new McpServer({ name: "tools" });\n'),
  ];
  const customerToFrontend: DetectedDataFlow = {
    id: "flow_1",
    sourceComponentId: "customer",
    targetComponentId: "frontend_app",
    type: "api_call",
    confidence: 0.9,
  };

  function run() {
    return applyHumanInteractionChannels({
      components: [customer, frontend, cli, backend],
      flows: [{ ...customerToFrontend }],
      files,
      sections,
    });
  }

  it("sets the web GUI channel on an existing human edge into a Next.js app", () => {
    const result = run();
    expect(result.flows.find((flow) => flow.id === "flow_1")).toMatchObject({ channel: "web_gui" });
  });

  it("adds a CLI edge from the person to a CLI package that had none", () => {
    const result = run();
    expect(result.flows).toContainEqual(
      expect.objectContaining({ sourceComponentId: "customer", targetComponentId: "cli_app", channel: "cli", relationship: "interacts" }),
    );
  });

  it("models an MCP server as person, then AI agent, then server", () => {
    const result = run();
    const agent = result.components.find(isAiAgentActor);
    expect(agent).toMatchObject({ name: "AI agent", type: "actor", subType: "automated_service" });
    expect(result.flows).toContainEqual(
      expect.objectContaining({ sourceComponentId: "customer", targetComponentId: agent?.id, relationship: "interacts" }),
    );
    expect(result.flows).toContainEqual(
      expect.objectContaining({ sourceComponentId: agent?.id, targetComponentId: "backend_app", channel: "mcp", protocol: "mcp" }),
    );
  });

  it("gives a server that also ships a CLI both a direct API edge and a CLI edge", () => {
    const result = applyHumanInteractionChannels({
      components: [customer, backend],
      flows: [{ id: "flow_4", sourceComponentId: "customer", targetComponentId: "backend_app", type: "api_call", confidence: 0.8 }],
      files: [makeFile("backend/package.json", packageJson({ name: "backend", bin: "cli.js", dependencies: { express: "4" } }))],
      sections: [makeSection("backend")],
    });
    expect(result.flows.map((flow) => flow.channel)).toEqual(["api_direct", "cli"]);
  });

  it("does not borrow channels from an example app that is its own section", () => {
    const platform = makeApplicationHub("platform_app", "packages/platform");
    const result = applyHumanInteractionChannels({
      components: [customer, platform],
      flows: [{ id: "flow_5", sourceComponentId: "customer", targetComponentId: "platform_app", type: "api_call", confidence: 0.8 }],
      files: [makeFile("packages/platform/examples/base/package.json", packageJson({ name: "base", dependencies: { next: "15" } }))],
      sections: [makeSection("packages/platform"), makeSection("packages/platform/examples/base")],
    });
    expect(result.flows[0].channel).toBeUndefined();
  });

  it("drops an injected actor's synthetic edge into a library package, and the actor with it", () => {
    const injectedUser = makeComponent({
      id: "injected_user",
      name: "User",
      type: "actor",
      subType: "customer",
      properties: { section_id: "packages/utils", sourceContext: "injected_default" },
    });
    const utilities = makeApplicationHub("utils_app", "packages/utils");
    const result = applyHumanInteractionChannels({
      components: [injectedUser, utilities],
      flows: [{ id: "flow_2", sourceComponentId: "injected_user", targetComponentId: "utils_app", type: "api_call", confidence: 0.5 }],
      files: [makeFile("packages/utils/package.json", packageJson({ name: "utils", exports: "./dist/index.js" }))],
      sections: [makeSection("packages/utils")],
    });
    expect(result.flows).toHaveLength(0);
    expect(result.components.map((component) => component.id)).toEqual(["utils_app"]);
  });

  it("keeps an evidence-backed actor edge into a library package", () => {
    const utilities = makeApplicationHub("utils_app", "packages/utils");
    const result = applyHumanInteractionChannels({
      components: [customer, utilities],
      flows: [
        {
          id: "flow_3",
          sourceComponentId: "customer",
          targetComponentId: "utils_app",
          type: "api_call",
          confidence: 0.8,
          sourceLocation: { filePath: "packages/utils/src/session.ts", startLine: 3, endLine: 3 },
        },
      ],
      files: [makeFile("packages/utils/package.json", packageJson({ name: "utils", exports: "./dist/index.js" }))],
      sections: [makeSection("packages/utils")],
    });
    expect(result.flows.map((flow) => flow.id)).toEqual(["flow_3"]);
  });
});
