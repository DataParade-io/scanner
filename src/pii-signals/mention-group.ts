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
