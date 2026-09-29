import type { AnalyzedFile, Site } from "./engine/analyzed-file";
import type { DeclarationKind, SameFileDeclaration } from "./engine/types";

/**
 * The declaration a mention line points at, following the labeling rules in
 * .agents/skills/curate-scanner-evaluation-corpus/references/mention-attribute-labeling.md.
 * `unresolved` means the name is imported, global, or not declared in this file.
 */
export type MentionDeclaration =
  | { line: number; kind: Exclude<DeclarationKind, "import"> }
  | "unresolved";

function fromSame(declaration: SameFileDeclaration | undefined): MentionDeclaration {
  if (!declaration || declaration.kind === "import") return "unresolved";
  return { line: declaration.line, kind: declaration.kind };
}

/** A key, field, or variable being defined declares on its own line (labeling rules 1 and 3). */
function ownLine(site: Extract<Site, { role: "definition" }>): MentionDeclaration | undefined {
  if (site.kind === "parameter") return { line: site.line, kind: "parameter" };
  if (site.kind === "key" || (site.kind === "field" && !site.implicit)) return { line: site.line, kind: "field" };
  if (site.kind === "local") return { line: site.line, kind: "local" };
  return undefined;
}

function readDeclaration(file: AnalyzedFile, site: Site): MentionDeclaration {
  if (site.role === "reference") return fromSame(file.lookup(site.name, site.node));
  if (site.role === "member") {
    const root = site.root;
    if (root.type === "identifier") return fromSame(file.lookup(root.name, root.node));
    if (root.type === "self" && root.firstMember) return fromSame(file.lookupMember(root.firstMember, root.node));
  }
  return "unresolved";
}

/**
 * Pick the occurrence of the concept on a 1-based line the way the labeling rules do:
 * a key, field, or parameter being defined; else an expression that reads the value;
 * else a variable, function, or class defined here. Returns undefined when the line has
 * no code occurrence to declare (string literals, types, comments).
 */
export function resolveMentionDeclaration(
  file: AnalyzedFile,
  line: number,
  isConceptToken: (token: string) => boolean,
): MentionDeclaration | undefined {
  const sites = file
    .sitesOnLine(line)
    .filter((site) => isConceptToken(site.name))
    .sort((a, b) => a.column - b.column);

  const definitions = sites.filter((site): site is Extract<Site, { role: "definition" }> => site.role === "definition");
  const reads = sites.filter((site) => site.role === "reference" || site.role === "member");

  // A parameter outranks a function name; then keys, fields, and variables defined here.
  const parameter = definitions.find((site) => site.kind === "parameter");
  if (parameter) return ownLine(parameter);
  for (const site of definitions) {
    const own = ownLine(site);
    if (own) return own;
  }
  // A name inside the callee (`send_email(x)`) only counts when nothing is passed or read.
  const read = reads.find((site) => !site.inCallee) ?? reads[0];
  if (read) return readDeclaration(file, read);
  for (const site of definitions) {
    if (site.kind === "function" || site.kind === "class") return { line: site.line, kind: site.kind };
  }
  return undefined;
}
