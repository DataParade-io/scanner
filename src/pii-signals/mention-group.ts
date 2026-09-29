/**
 * First-pass grouping of code mentions into data items (KDATAP-c8a46a).
 *
 * One signal concept such as `email` usually covers several real data items: a
 * member's account email, a staff user's email, a newsletter sender address. This
 * grouper reads the qualifier on the matched line:
 *
 * - a compound identifier around the concept: `sender_email`, `customerEmail`
 * - otherwise the receiver of a property read: `member.email`, `order.get('email')`
 *
 * Generic words (`recipient`, `new`, `data`, `user`, ...) are not qualifiers, since
 * they name a role or a container rather than whose data it is. Mentions without a
 * qualifier get no group and are scored as singletons. Precision comes first; later
 * passes resolve declarations and value flow (KDATAP-a565be).
 */

const GENERIC_WORDS = new Set([
  "a", "addr", "address", "addresses", "args", "attrs", "body", "check", "clean", "cleaned",
  "ctx", "current", "data", "default", "e", "existing", "field", "format", "from", "get",
  "has", "id", "ids", "info", "input", "instance", "is", "it", "item", "list", "lower", "m",
  "main", "model", "models", "new", "normalized", "obj", "of", "old", "options", "opts",
  "params", "parse", "parser", "payload", "props", "raw", "record", "recipient", "recipients",
  "remove", "req", "result", "row", "self", "send", "service", "set", "str", "target", "task",
  "the", "this", "to", "trimmed", "u", "update", "user", "valid", "validate", "validated",
  "value", "verify", "with", "x",
]);

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

function identifierWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\-\s.]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The qualifier naming whose data a mention of the signal on this line is, or
 * undefined when the line has none. `signalId` is the signal's snake_case id.
 */
export function mentionQualifier(line: string, signalId: string): string | undefined {
  const conceptWords = identifierWords(signalId);
  for (const identifier of line.match(IDENTIFIER) ?? []) {
    const words = identifierWords(identifier);
    if (!conceptWords.every((word) => words.includes(word)) || words.length === conceptWords.length) {
      continue;
    }
    const qualifiers = words.filter((word) => !GENERIC_WORDS.has(word) && !conceptWords.includes(word));
    if (qualifiers.length > 0) {
      return qualifiers.join("_");
    }
  }
  const conceptPattern = conceptWords.map(escapeRegExp).join("[_]?");
  const receiver = new RegExp(
    `([A-Za-z_][A-Za-z0-9_]*)\\s*(?:\\??\\.|\\[\\s*['"]|\\.get\\(\\s*['"])${conceptPattern}\\b`,
    "i",
  ).exec(line);
  if (receiver) {
    const words = identifierWords(receiver[1]).filter((word) => !GENERIC_WORDS.has(word));
    if (words.length > 0) {
      return words[words.length - 1];
    }
  }
  return undefined;
}

/** Group id for a code mention of a signal, e.g. `email:customer`, or undefined. */
export function mentionGroup(signalId: string, line: string): string | undefined {
  const qualifier = mentionQualifier(line, signalId);
  return qualifier ? `${signalId}:${qualifier}` : undefined;
}

const MODEL_FILE = /(^|\/)models?\/|[-_]repository\.[A-Za-z]+$|(^|\/)models?\.py$/;
const FILE_ROLE_WORDS = new Set(["repository", "model", "models", "index"]);

/**
 * The entity a model or repository file is about: `models/member.js` -> `member`,
 * `member-repository.js` -> `member`. Undefined for other files, and for files whose
 * name is only generic words (`models.py`, `user.js` since `user` is generic).
 */
export function modelFileEntity(filePath: string): string | undefined {
  if (!MODEL_FILE.test(filePath)) return undefined;
  const base = filePath.split("/").pop()!.replace(/\.[A-Za-z]+$/, "");
  const words = identifierWords(base).filter((word) => !GENERIC_WORDS.has(word) && !FILE_ROLE_WORDS.has(word));
  const last = words[words.length - 1];
  if (!last) return undefined;
  return last.length > 3 && last.endsWith("s") && !last.endsWith("ss") ? last.slice(0, -1) : last;
}

interface GroupableHit {
  id: string;
  location?: "code" | "comment";
  evidence: { filePath: string };
  group?: string;
  declaration?: { line: number; kind: string } | "unresolved";
}

/**
 * Second pass: join code mentions that share a same-file declaration, then name each
 * joined set (KDATAP-c8a46a). A declaration never spans two data items in the labeled
 * corpus, so it is a safe join. Mentions joined through a declaration take the set's
 * qualifier group; a set with no qualifier is named after its declaration, e.g.
 * `email@src/a.js:12`. Sets that share a qualifier are joined too, so the qualifier
 * links declarations across files.
 */
export function assignDeclarationGroups<T extends GroupableHit>(hits: T[]): T[] {
  const parent = new Map<string, string>();
  const find = (node: string): string => {
    let root = node;
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    parent.set(node, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent.set(a, b);
  };
  const declarationNode = (hit: T): string | undefined =>
    hit.declaration && hit.declaration !== "unresolved"
      ? `${hit.id}@${hit.evidence.filePath}:${hit.declaration.line}`
      : undefined;

  hits.forEach((hit, index) => {
    if (hit.location === "comment") return;
    const node = `hit:${index}`;
    parent.set(node, node);
    const declaration = declarationNode(hit);
    if (declaration) union(node, `decl:${declaration}`);
    if (hit.group) union(node, `group:${hit.group}`);
  });

  // A mention with no qualifier in a model or repository file joins the file's entity
  // group (member-repository.js -> email:member), but only when that group exists.
  const existingGroups = new Set(hits.map((hit) => hit.group).filter((group): group is string => !!group));
  hits.forEach((hit, index) => {
    if (hit.location === "comment" || hit.group) return;
    const entity = modelFileEntity(hit.evidence.filePath);
    const group = entity ? `${hit.id}:${entity}` : undefined;
    if (group && existingGroups.has(group)) union(`hit:${index}`, `group:${group}`);
  });

  const qualifierCounts = new Map<string, Map<string, number>>();
  hits.forEach((hit, index) => {
    if (hit.location === "comment" || !hit.group) return;
    const root = find(`hit:${index}`);
    const counts = qualifierCounts.get(root) ?? new Map<string, number>();
    counts.set(hit.group, (counts.get(hit.group) ?? 0) + 1);
    qualifierCounts.set(root, counts);
  });
  const nameByRoot = new Map<string, string>();
  for (const [root, counts] of qualifierCounts) {
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    nameByRoot.set(root, best[0]);
  }

  // An unqualified set is named after its smallest declaration, so the id is stable.
  const declarationNameByRoot = new Map<string, string>();
  hits.forEach((hit, index) => {
    const declaration = hit.location === "comment" ? undefined : declarationNode(hit);
    if (!declaration) return;
    const root = find(`hit:${index}`);
    const current = declarationNameByRoot.get(root);
    if (current === undefined || declaration.localeCompare(current) < 0) {
      declarationNameByRoot.set(root, declaration);
    }
  });

  return hits.map((hit, index) => {
    if (hit.location === "comment") return hit;
    const root = find(`hit:${index}`);
    const name = nameByRoot.get(root) ?? declarationNameByRoot.get(root);
    return name === undefined || name === hit.group ? hit : { ...hit, group: name };
  });
}
