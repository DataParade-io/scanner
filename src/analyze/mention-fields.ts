import type { AnalyzedFile } from "./engine/analyzed-file";
import { entityName } from "../pii-signals/mention-group";

const CONTAINER_OWNER =
  /(Options|Answers?|Params|Parameters|Args|Arguments|Body|Input|Payload|Props|Config|Request|Response|Data|Dto|DTO)$/;

export interface MentionFieldKey {
  /** `entity.field`, e.g. `order.user_email` or `member.email`. */
  key: string;
  /** The line declares the field rather than reading it. */
  definition: boolean;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Entity fields a line defines or reads, for joining a field's reads to its
 * definition across files (KDATAP-c8a46a):
 *
 * - a field or key definition is owned by the enclosing object key or class
 *   (`email:` under `members:` -> `member.email`; `user_email` in class Order ->
 *   `order.user_email`)
 * - a read directly off a named object (`order.user_email`, `member.get('email')`)
 *   uses that name as the entity; `self.x` / `this.x` uses the enclosing class
 */
export function mentionFieldKeys(
  file: AnalyzedFile,
  line: number,
  sourceLine: string,
  isConceptToken: (token: string) => boolean,
): MentionFieldKey[] {
  const keys = new Map<string, boolean>();
  const add = (owner: string | undefined, field: string, definition: boolean) => {
    // A field of an options, answers, params or payload type describes an input shape, not
    // an entity: `interface CmdOptions { email?: string }`, `interface Answers {...}`.
    if (owner && CONTAINER_OWNER.test(owner)) return;
    const entity = owner ? entityName(owner) : undefined;
    if (!entity) return;
    const key = `${entity}.${field}`;
    keys.set(key, (keys.get(key) ?? false) || definition);
  };
  for (const site of file.sitesOnLine(line)) {
    if (!isConceptToken(site.name)) continue;
    if (site.role === "definition" && (site.kind === "field" || site.kind === "key")) {
      add(file.definitionOwner(site.line, site.column), site.name, true);
    } else if (
      site.role === "definition" &&
      site.kind === "function" &&
      new RegExp(`^\\s*(?:static\\s+)?get\\s+${escapeRegExp(site.name)}\\s*\\(`).test(sourceLine)
    ) {
      // A getter is a field of its class: `get fromEmailAddress() {` is read as
      // `this.fromEmailAddress` elsewhere in the class.
      add(file.enclosingClass(site.line, site.column)?.name, site.name, true);
    } else if (site.role === "member" && !site.inCallee) {
      if (site.root.type === "self" && site.root.firstMember === site.name) {
        add(file.enclosingClass(site.line, site.column)?.name, site.name, false);
      } else if (site.root.type === "identifier") {
        const direct = new RegExp(
          `\\b${escapeRegExp(site.root.name)}\\s*(?:\\??\\.(?:get\\(\\s*)?|\\[)\\s*['"]?${escapeRegExp(site.name)}\\b`,
        );
        if (direct.test(sourceLine)) add(site.root.name, site.name, false);
      }
    }
  }
  return [...keys.entries()].map(([key, definition]) => ({ key, definition }));
}

/**
 * Declarations of concept variables passed into a key on this line
 * (`customer_email=recipient_email`, `"email": customer_email`). Passing a value
 * into a key or keyword argument keeps the same data item, so the mention also joins
 * the passed variable's declaration (KDATAP-c8a46a). Lines without such a key return
 * nothing, so comparisons like `email !== oldEmail` never join two variables.
 */
/**
 * Lines of other mentions whose variable is passed into a concept key on this line,
 * when the variable's own name does not carry the concept: `const to = user.email;`
 * then `toEmail: to`. The passed variable's declaration line is itself a mention, so
 * the key joins that mention (KDATAP-c8a46a).
 */
export function passedMentionLines(
  file: AnalyzedFile,
  line: number,
  isConceptToken: (token: string) => boolean,
  mentionLines: ReadonlySet<number>,
): number[] {
  const sites = file.sitesOnLine(line);
  const passesIntoKey = sites.some(
    (site) => site.role === "definition" && site.kind === "key" && isConceptToken(site.name),
  );
  if (!passesIntoKey) return [];
  const lines = new Set<number>();
  for (const site of sites) {
    if (site.role !== "reference" || site.inCallee || isConceptToken(site.name)) continue;
    const declaration = file.lookup(site.name, site.node);
    if (declaration && declaration.kind === "local" && declaration.line !== line && mentionLines.has(declaration.line)) {
      lines.add(declaration.line);
    }
  }
  return [...lines];
}

export function passedValueDeclarations(
  file: AnalyzedFile,
  line: number,
  isConceptToken: (token: string) => boolean,
): Array<{ line: number; name: string }> {
  const sites = file.sitesOnLine(line);
  const passesIntoKey = sites.some(
    (site) => site.role === "definition" && site.kind === "key" && isConceptToken(site.name),
  );
  if (!passesIntoKey) return [];
  const found = new Map<string, { line: number; name: string }>();
  for (const site of sites) {
    if (site.role !== "reference" || site.inCallee || !isConceptToken(site.name)) continue;
    const declaration = file.lookup(site.name, site.node);
    if (declaration && (declaration.kind === "parameter" || declaration.kind === "local")) {
      found.set(`${declaration.line}#${site.name}`, { line: declaration.line, name: site.name });
    }
  }
  return [...found.values()];
}
