import { resolveAliasRuleIdsForToken } from "./pii-signal-aliases";
import { loadPiiSignalRules } from "./pii-signal-rules";

/**
 * A predicate telling whether one source token (an identifier, property name, or
 * unquoted string key) is an occurrence of the given signal, by the same rules the
 * line matcher uses: the rule's patterns, or an alias that resolves to the rule.
 */
export function signalTokenMatcher(signalId: string, filePath: string): (token: string) => boolean {
  const rule = loadPiiSignalRules().find((candidate) => candidate.id === signalId);
  const conceptWords = splitWords(signalId);
  return (token) => {
    if (rule?.patterns.some((pattern) => pattern.test(token))) return true;
    // Compound names around the concept: `sender_email`, `customerEmail`, `to_emails`.
    const words = splitWords(token).map((word) => (word.endsWith("s") ? word.slice(0, -1) : word));
    if (conceptWords.every((word) => words.includes(word))) return true;
    return resolveAliasRuleIdsForToken(token, token, 0, filePath).includes(signalId);
  };
}

function splitWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .split(/[_\-\s.]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}
