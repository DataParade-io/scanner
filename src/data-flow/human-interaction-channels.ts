import type { DetectedComponent } from "../core/types/component";
import type {
  DetectedDataFlow,
  FlowTransport,
  HumanInteractionChannel,
  HumanInteractionChannelEvidence,
} from "../core/types/data-flow";
import type { FileInfo } from "../core/types/file";
import type { ServiceSection } from "../core/sectioning/discover-service-sections";
import { findApplicationHubForFlows } from "./application-hub";

export const AI_AGENT_ACTOR_SUBTYPE = "automated_service";
export const AI_AGENT_ACTOR_KIND_PROPERTY = "actorKind";
export const AI_AGENT_ACTOR_KIND = "ai_agent";
export const AI_AGENT_ACTOR_NAME = "AI agent";
const INJECTED_DEFAULT_SOURCE_CONTEXT = "injected_default";
const INJECTED_CHANNEL_ACTOR_SOURCE_CONTEXT = "injected_for_interaction_channel";

type DetectedChannel = Exclude<HumanInteractionChannel, "unknown" | "email">;

export interface SectionInteractionSurface {
  sectionId: string;
  sectionDirectory: string;
  isLibraryPackage: boolean;
  packageManifestCount: number;
  libraryPackageManifestCount: number;
  evidenceByChannel: Map<DetectedChannel, HumanInteractionChannelEvidence[]>;
  mcpServerTransport?: FlowTransport;
}

interface CodeSignal {
  channel: DetectedChannel;
  signal: string;
  pattern: RegExp;
}

const CHANNEL_PRIORITY_FOR_HUMAN_ACTOR_EDGES: DetectedChannel[] = [
  "web_gui",
  "mobile_app",
  "desktop_app",
  "api_direct",
  "cli",
];

const PACKAGE_DEPENDENCY_CHANNELS: Array<[DetectedChannel, string[]]> = [
  ["cli", ["commander", "yargs", "@oclif/core", "oclif", "meow", "cac", "citty", "clipanion", "sade", "caporal"]],
  ["web_gui", ["next", "react-dom", "vue", "nuxt", "svelte", "@sveltejs/kit", "@angular/core", "solid-js", "@remix-run/react", "gatsby", "astro", "preact"]],
  ["mobile_app", ["react-native", "expo"]],
  ["desktop_app", ["electron", "@tauri-apps/api"]],
  ["api_direct", ["express", "@nestjs/core", "fastify", "koa", "hono", "@hapi/hapi", "restify"]],
];

const CHANNELS_THAT_A_LIBRARY_DEPENDENCY_DOES_NOT_PROVE = new Set<DetectedChannel>([
  "web_gui",
  "mobile_app",
  "desktop_app",
  "api_direct",
]);

const CHANNELS_THAT_A_COMMAND_LINE_PACKAGE_DEPENDENCY_DOES_NOT_PROVE = new Set<DetectedChannel>([
  "web_gui",
  "mobile_app",
  "desktop_app",
]);

const CODE_SIGNALS: CodeSignal[] = [
  { channel: "mcp", signal: "MCP server (TypeScript SDK)", pattern: /new\s+McpServer\s*\(|@modelcontextprotocol\/sdk\/server/ },
  { channel: "mcp", signal: "MCP server (FastMCP)", pattern: /\bFastMCP\s*\(/ },
  { channel: "mcp", signal: "MCP server (Python SDK)", pattern: /^\s*from\s+mcp\.server\b/m },
  { channel: "mcp", signal: "MCP server (mcp-go)", pattern: /"github\.com\/mark3labs\/mcp-go\/server"/ },
  { channel: "cli", signal: "click", pattern: /^\s*(?:import\s+click\b|from\s+click\s+import\b)/m },
  { channel: "cli", signal: "typer", pattern: /^\s*(?:import\s+typer\b|from\s+typer\s+import\b)/m },
  { channel: "cli", signal: "argparse", pattern: /\bargparse\.ArgumentParser\s*\(/ },
  { channel: "cli", signal: "cobra", pattern: /"github\.com\/spf13\/cobra"/ },
  { channel: "cli", signal: "urfave/cli", pattern: /"github\.com\/urfave\/cli(?:\/v\d+)?"/ },
  { channel: "cli", signal: "Rails rake task", pattern: /^\s*task\s+[:\w]+\s*(?:=>|do\b)/m },
  { channel: "web_gui", signal: "Go html/template", pattern: /"html\/template"/ },
  { channel: "api_direct", signal: "NestJS application", pattern: /\bNestFactory\.create\s*[<(]/ },
  { channel: "api_direct", signal: "Express application", pattern: /\bexpress\(\s*\)/ },
  { channel: "api_direct", signal: "Fastify application", pattern: /\b(?:fastify|Fastify)\(\s*\{?/ },
  { channel: "api_direct", signal: "Hono application", pattern: /\bnew\s+Hono\s*\(/ },
  { channel: "api_direct", signal: "FastAPI", pattern: /^\s*from\s+fastapi\s+import\b/m },
  { channel: "api_direct", signal: "Flask", pattern: /^\s*from\s+flask\s+import\b/m },
  { channel: "api_direct", signal: "Django REST framework", pattern: /^\s*from\s+rest_framework\b/m },
  { channel: "api_direct", signal: "Graphene", pattern: /^\s*import\s+graphene\b/m },
  { channel: "api_direct", signal: "gin", pattern: /"github\.com\/gin-gonic\/gin"/ },
  { channel: "api_direct", signal: "chi", pattern: /"github\.com\/go-chi\/chi(?:\/v\d+)?"/ },
  { channel: "api_direct", signal: "echo", pattern: /"github\.com\/labstack\/echo(?:\/v\d+)?"/ },
  { channel: "api_direct", signal: "fiber", pattern: /"github\.com\/gofiber\/fiber(?:\/v\d+)?"/ },
  { channel: "api_direct", signal: "Rails API controller", pattern: /<\s*ActionController::API\b/ },
];

const MCP_STDIO_TRANSPORT_PATTERN = /StdioServerTransport|stdio_server\s*\(|transport\s*=\s*["']stdio["']/;
const MCP_HTTP_TRANSPORT_PATTERN =
  /StreamableHTTPServerTransport|SSEServerTransport|transport\s*=\s*["'](?:sse|streamable-http|http)["']/;

const TEST_FILE_PATH = /(?:\.(?:test|spec)\.[cm]?[jt]sx?$|_test\.(?:go|py)$|(?:^|\/)(?:__tests__|tests?|spec|fixtures?)\/)/;

const EXAMPLE_OR_SAMPLE_PATH = /(?:^|\/)(?:examples?|samples?|demos?|templates?)\//;

const CODE_LANGUAGES_WITH_SIGNALS = new Set<string>([
  "typescript",
  "javascript",
  "python",
  "go",
  "ruby",
  "java",
  "kotlin",
  "csharp",
  "php",
  "rust",
]);

const RAILS_VIEW_TEMPLATE_PATH = /(?:^|\/)app\/views\/.+\.(?:erb|haml|slim)$/;

function lineNumberOfFirstMatch(content: string, pattern: RegExp): number {
  const match = pattern.exec(content);
  if (!match) return 1;
  return content.slice(0, match.index).split("\n").length;
}

function lineNumberOfJsonKey(content: string, key: string): number {
  return lineNumberOfFirstMatch(content, new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"\\s*:`));
}

function sectionDirectoryContainsPath(sectionDirectory: string, filePath: string): boolean {
  return sectionDirectory === "" || filePath === sectionDirectory || filePath.startsWith(`${sectionDirectory}/`);
}

function findOwningSection(
  filePath: string,
  sectionsByLongestDirectoryFirst: ServiceSection[],
): ServiceSection | undefined {
  return sectionsByLongestDirectoryFirst.find((section) =>
    sectionDirectoryContainsPath(section.sectionDir, filePath),
  );
}

function addEvidence(
  surface: SectionInteractionSurface,
  channel: DetectedChannel,
  evidence: HumanInteractionChannelEvidence,
): void {
  const existingEvidence = surface.evidenceByChannel.get(channel) ?? [];
  if (existingEvidence.length >= 3) return;
  existingEvidence.push(evidence);
  surface.evidenceByChannel.set(channel, existingEvidence);
}

interface PackageManifestReading {
  isLibraryPackage: boolean;
  evidence: Array<[DetectedChannel, HumanInteractionChannelEvidence]>;
}

function readPackageManifest(file: FileInfo): PackageManifestReading | undefined {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(file.content) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!manifest || typeof manifest !== "object") return undefined;

  const scripts = (manifest.scripts ?? {}) as Record<string, unknown>;
  const declaresBinary = manifest.bin !== undefined;
  const hasRunnableScript = ["start", "serve", "preview"].some((scriptName) => scriptName in scripts);
  const exportsModule = ["main", "exports", "module"].some((fieldName) => fieldName in manifest);
  const isLibraryPackage = exportsModule && !declaresBinary && !hasRunnableScript;

  const dependencyNames = new Set([
    ...Object.keys((manifest.dependencies ?? {}) as Record<string, unknown>),
    ...Object.keys((manifest.devDependencies ?? {}) as Record<string, unknown>),
  ]);

  const evidence: Array<[DetectedChannel, HumanInteractionChannelEvidence]> = [];
  if (declaresBinary) {
    evidence.push([
      "cli",
      { signal: "package.json bin", filePath: file.path, line: lineNumberOfJsonKey(file.content, "bin") },
    ]);
  }
  for (const [channel, packageNames] of PACKAGE_DEPENDENCY_CHANNELS) {
    if (isLibraryPackage && CHANNELS_THAT_A_LIBRARY_DEPENDENCY_DOES_NOT_PROVE.has(channel)) continue;
    if (declaresBinary && CHANNELS_THAT_A_COMMAND_LINE_PACKAGE_DEPENDENCY_DOES_NOT_PROVE.has(channel)) continue;
    const dependencyName = packageNames.find((packageName) => dependencyNames.has(packageName));
    if (!dependencyName) continue;
    evidence.push([
      channel,
      {
        signal: `dependency ${dependencyName}`,
        filePath: file.path,
        line: lineNumberOfJsonKey(file.content, dependencyName),
      },
    ]);
  }
  return { isLibraryPackage, evidence };
}

export function detectSectionInteractionSurfaces(
  files: FileInfo[],
  sections: ServiceSection[],
): Map<string, SectionInteractionSurface> {
  const surfacesBySectionId = new Map<string, SectionInteractionSurface>();
  const sectionsByLongestDirectoryFirst = [...sections].sort(
    (left, right) => right.sectionDir.length - left.sectionDir.length,
  );
  for (const section of sections) {
    surfacesBySectionId.set(section.id, {
      sectionId: section.id,
      sectionDirectory: section.sectionDir,
      isLibraryPackage: false,
      packageManifestCount: 0,
      libraryPackageManifestCount: 0,
      evidenceByChannel: new Map(),
    });
  }

  const sortedFiles = [...files].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  for (const file of sortedFiles) {
    const owningSection = findOwningSection(file.path, sectionsByLongestDirectoryFirst);
    if (!owningSection) continue;
    const surface = surfacesBySectionId.get(owningSection.id);
    if (!surface || typeof file.content !== "string") continue;

    const pathInsideSection = owningSection.sectionDir
      ? file.path.slice(owningSection.sectionDir.length + 1)
      : file.path;
    if (EXAMPLE_OR_SAMPLE_PATH.test(pathInsideSection) || TEST_FILE_PATH.test(pathInsideSection)) continue;

    if (file.name === "package.json") {
      const reading = readPackageManifest(file);
      if (reading) {
        surface.packageManifestCount += 1;
        if (reading.isLibraryPackage) surface.libraryPackageManifestCount += 1;
        surface.isLibraryPackage = surface.libraryPackageManifestCount === surface.packageManifestCount;
        for (const [channel, evidence] of reading.evidence) addEvidence(surface, channel, evidence);
      }
      continue;
    }

    if (RAILS_VIEW_TEMPLATE_PATH.test(file.path)) {
      addEvidence(surface, "web_gui", { signal: "Rails view template", filePath: file.path, line: 1 });
      continue;
    }

    if (!CODE_LANGUAGES_WITH_SIGNALS.has(file.language)) continue;

    for (const codeSignal of CODE_SIGNALS) {
      if (!codeSignal.pattern.test(file.content)) continue;
      addEvidence(surface, codeSignal.channel, {
        signal: codeSignal.signal,
        filePath: file.path,
        line: lineNumberOfFirstMatch(file.content, codeSignal.pattern),
      });
    }

    if (surface.evidenceByChannel.has("mcp") && surface.mcpServerTransport === undefined) {
      if (MCP_STDIO_TRANSPORT_PATTERN.test(file.content)) surface.mcpServerTransport = "stdio";
      else if (MCP_HTTP_TRANSPORT_PATTERN.test(file.content)) surface.mcpServerTransport = "http";
    }
  }

  return surfacesBySectionId;
}

function mergeSurfacesUnderSectionDirectory(
  surfacesBySectionId: Map<string, SectionInteractionSurface>,
  sectionId: string,
): SectionInteractionSurface | undefined {
  const nestedSurfaces = [...surfacesBySectionId.values()].filter(
    (surface) =>
      surface.sectionDirectory.startsWith(`${sectionId}/`) &&
      !EXAMPLE_OR_SAMPLE_PATH.test(`${surface.sectionDirectory.slice(sectionId.length + 1)}/`) &&
      !TEST_FILE_PATH.test(`${surface.sectionDirectory.slice(sectionId.length + 1)}/`),
  );
  if (nestedSurfaces.length === 0) return undefined;
  const merged: SectionInteractionSurface = {
    sectionId,
    sectionDirectory: sectionId,
    isLibraryPackage: nestedSurfaces.every((surface) => surface.isLibraryPackage),
    packageManifestCount: 0,
    libraryPackageManifestCount: 0,
    evidenceByChannel: new Map(),
  };
  for (const nestedSurface of nestedSurfaces) {
    merged.packageManifestCount += nestedSurface.packageManifestCount;
    merged.libraryPackageManifestCount += nestedSurface.libraryPackageManifestCount;
    for (const [channel, evidenceList] of nestedSurface.evidenceByChannel) {
      for (const evidence of evidenceList) addEvidence(merged, channel, evidence);
    }
    merged.mcpServerTransport ??= nestedSurface.mcpServerTransport;
  }
  return merged;
}

function surfaceForSectionId(
  surfacesBySectionId: Map<string, SectionInteractionSurface>,
  sectionId: string,
): SectionInteractionSurface | undefined {
  if (!sectionId) return undefined;
  const exactSurface = surfacesBySectionId.get(sectionId);
  if (exactSurface && exactSurface.evidenceByChannel.size > 0) return exactSurface;
  return mergeSurfacesUnderSectionDirectory(surfacesBySectionId, sectionId) ?? exactSurface;
}

function sectionIdOfComponent(component: DetectedComponent | undefined): string {
  const sectionId = component?.properties?.section_id;
  return typeof sectionId === "string" ? sectionId.trim() : "";
}

export function isAiAgentActor(component: DetectedComponent | undefined): boolean {
  return component?.type === "actor" && component.properties?.[AI_AGENT_ACTOR_KIND_PROPERTY] === AI_AGENT_ACTOR_KIND;
}

function isHumanActor(component: DetectedComponent | undefined): boolean {
  return (
    component?.type === "actor" &&
    !isAiAgentActor(component) &&
    component.subType !== "automated_service" &&
    component.subType !== "service_account"
  );
}

function chooseChannelForHumanActorEdge(
  surface: SectionInteractionSurface | undefined,
): DetectedChannel | undefined {
  if (!surface) return undefined;
  return CHANNEL_PRIORITY_FOR_HUMAN_ACTOR_EDGES.find((channel) => surface.evidenceByChannel.has(channel));
}

function surfaceHasAnyChannel(surface: SectionInteractionSurface): boolean {
  return surface.evidenceByChannel.size > 0;
}

function firstEvidenceAsSourceLocation(evidence: HumanInteractionChannelEvidence[]) {
  const first = evidence[0];
  return first ? { filePath: first.filePath, startLine: first.line, endLine: first.line } : undefined;
}

export interface HumanInteractionChannelInput {
  components: DetectedComponent[];
  flows: DetectedDataFlow[];
  files: FileInfo[];
  sections: ServiceSection[];
}

export interface HumanInteractionChannelResult {
  components: DetectedComponent[];
  flows: DetectedDataFlow[];
}

function isSyntheticActorEdgeIntoLibraryPackage(
  flow: DetectedDataFlow,
  componentsById: Map<string, DetectedComponent>,
  surfacesBySectionId: Map<string, SectionInteractionSurface>,
): boolean {
  const sourceComponent = componentsById.get(flow.sourceComponentId);
  if (!isHumanActor(sourceComponent)) return false;
  if (sourceComponent?.properties?.sourceContext !== INJECTED_DEFAULT_SOURCE_CONTEXT) return false;
  if (flow.sourceLocation || (flow.sourceLocations?.length ?? 0) > 0) return false;
  const surface = surfaceForSectionId(
    surfacesBySectionId,
    sectionIdOfComponent(componentsById.get(flow.targetComponentId)),
  );
  return surface !== undefined && surface.isLibraryPackage && !surfaceHasAnyChannel(surface);
}

function componentIdsTouchedByFlows(flows: DetectedDataFlow[]): Set<string> {
  return new Set(flows.flatMap((flow) => [flow.sourceComponentId, flow.targetComponentId]));
}

function nextNumericSuffix(existingIds: string[], prefix: string): number {
  let highest = 0;
  for (const id of existingIds) {
    if (!id.startsWith(prefix)) continue;
    const parsed = Number.parseInt(id.slice(prefix.length), 10);
    if (!Number.isNaN(parsed)) highest = Math.max(highest, parsed);
  }
  return highest + 1;
}

export function applyHumanInteractionChannels(
  input: HumanInteractionChannelInput,
): HumanInteractionChannelResult {
  const surfacesBySectionId = detectSectionInteractionSurfaces(input.files, input.sections);
  let components = [...input.components];
  const componentsById = new Map(components.map((component) => [component.id, component]));

  let flows = input.flows.filter(
    (flow) => !isSyntheticActorEdgeIntoLibraryPackage(flow, componentsById, surfacesBySectionId),
  );
  const componentIdsWithFlowsBeforeDropping = componentIdsTouchedByFlows(input.flows);
  const componentIdsWithFlowsAfterDropping = componentIdsTouchedByFlows(flows);
  components = components.filter(
    (component) =>
      !(
        isHumanActor(component) &&
        component.properties?.sourceContext === INJECTED_DEFAULT_SOURCE_CONTEXT &&
        componentIdsWithFlowsBeforeDropping.has(component.id) &&
        !componentIdsWithFlowsAfterDropping.has(component.id)
      ),
  );

  for (const flow of flows) {
    if (!isHumanActor(componentsById.get(flow.sourceComponentId))) continue;
    const targetComponent = componentsById.get(flow.targetComponentId);
    if (targetComponent?.type !== "asset") continue;
    const surface = surfaceForSectionId(surfacesBySectionId, sectionIdOfComponent(targetComponent));
    const channel = chooseChannelForHumanActorEdge(surface);
    if (!channel || !surface) continue;
    flow.channel = channel;
    flow.channelEvidence = surface.evidenceByChannel.get(channel);
  }

  let nextFlowSuffix = nextNumericSuffix(flows.map((flow) => flow.id), "flow_channel_");
  let nextComponentSuffix = nextNumericSuffix(components.map((component) => component.id), "cmp_channel_");
  const additionalFlows: DetectedDataFlow[] = [];
  const additionalComponents: DetectedComponent[] = [];

  const primaryHumanActor = (): DetectedComponent => {
    const existing =
      components.find((component) => isHumanActor(component) && component.subType === "customer") ??
      components.find((component) => isHumanActor(component)) ??
      additionalComponents.find((component) => isHumanActor(component));
    if (existing) return existing;
    const created: DetectedComponent = {
      id: `cmp_channel_${nextComponentSuffix++}`,
      name: "User",
      type: "actor",
      subType: "customer",
      confidence: 0.5,
      detectedFrom: [],
      sourceLocations: [],
      properties: { sourceContext: INJECTED_CHANNEL_ACTOR_SOURCE_CONTEXT, section_id: "root", section_role: "root" },
    };
    additionalComponents.push(created);
    return created;
  };

  const findComponentIncludingAdditional = (componentId: string): DetectedComponent | undefined =>
    componentsById.get(componentId) ?? additionalComponents.find((component) => component.id === componentId);

  const sortedSurfaces = [...surfacesBySectionId.values()].sort((left, right) =>
    left.sectionId < right.sectionId ? -1 : left.sectionId > right.sectionId ? 1 : 0,
  );

  const sectionAlreadyHasHumanCommandLineEdge = (sectionId: string): boolean =>
    [...flows, ...additionalFlows].some(
      (flow) =>
        flow.channel === "cli" &&
        isHumanActor(findComponentIncludingAdditional(flow.sourceComponentId)) &&
        sectionIdOfComponent(findComponentIncludingAdditional(flow.targetComponentId)) === sectionId,
    );

  for (const surface of sortedSurfaces) {
    const cliEvidence = surface.evidenceByChannel.get("cli");
    if (!cliEvidence) continue;
    const hub = findApplicationHubForFlows(components, surface.sectionId);
    if (!hub || sectionIdOfComponent(hub) !== surface.sectionId) continue;
    if (sectionAlreadyHasHumanCommandLineEdge(surface.sectionId)) continue;
    additionalFlows.push({
      id: `flow_channel_${nextFlowSuffix++}`,
      sourceComponentId: primaryHumanActor().id,
      targetComponentId: hub.id,
      type: "api_call",
      confidence: 0.7,
      sourceLocation: firstEvidenceAsSourceLocation(cliEvidence),
      relationship: "interacts",
      channel: "cli",
      channelEvidence: cliEvidence,
    });
  }

  for (const surface of sortedSurfaces) {
    const mcpEvidence = surface.evidenceByChannel.get("mcp");
    if (!mcpEvidence) continue;
    const hub = findApplicationHubForFlows(components, surface.sectionId);
    if (!hub) continue;
    const aiAgent: DetectedComponent = {
      id: `cmp_channel_${nextComponentSuffix++}`,
      name: AI_AGENT_ACTOR_NAME,
      type: "actor",
      subType: AI_AGENT_ACTOR_SUBTYPE,
      description: "An AI agent that calls this MCP server on a person's behalf",
      confidence: 0.7,
      detectedFrom: [],
      sourceLocations: mcpEvidence.map((evidence) => ({
        filePath: evidence.filePath,
        startLine: evidence.line,
        endLine: evidence.line,
      })),
      properties: {
        [AI_AGENT_ACTOR_KIND_PROPERTY]: AI_AGENT_ACTOR_KIND,
        sourceContext: INJECTED_CHANNEL_ACTOR_SOURCE_CONTEXT,
        section_id: sectionIdOfComponent(hub),
        section_role: hub.properties?.section_role ?? "service",
      },
    };
    additionalComponents.push(aiAgent);
    const person = primaryHumanActor();
    additionalFlows.push({
      id: `flow_channel_${nextFlowSuffix++}`,
      sourceComponentId: person.id,
      targetComponentId: aiAgent.id,
      type: "api_call",
      confidence: 0.6,
      relationship: "interacts",
    });
    additionalFlows.push({
      id: `flow_channel_${nextFlowSuffix++}`,
      sourceComponentId: aiAgent.id,
      targetComponentId: hub.id,
      type: "api_call",
      confidence: 0.7,
      sourceLocation: firstEvidenceAsSourceLocation(mcpEvidence),
      relationship: "interacts",
      channel: "mcp",
      channelEvidence: mcpEvidence,
      protocol: "mcp",
      ...(surface.mcpServerTransport ? { transport: surface.mcpServerTransport } : {}),
    });
  }

  flows = [...flows, ...additionalFlows];
  components = [...components, ...additionalComponents];
  return { components, flows };
}
