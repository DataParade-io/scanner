/**
 * Identifier-token aliases for PII signal matching.
 *
 * Maps normalized source tokens (field names, parameter names, schema columns)
 * to existing rule ids from patterns/pii-signals.rules.yaml.
 *
 * Base entries align with EVIDENCE_ALIAS_TO_RULE in
 * tests/eval/canonical/compat/data-item-migration.ts; extensions cover
 * compound tokens that line-regex rules miss (user_email, user_pass, fax, …).
 */
export const PII_SIGNAL_ALIASES: Readonly<Record<string, string>> = {
  // EVIDENCE_ALIAS_TO_RULE (migration compat)
  mail: "email",
  user_email: "email",
  invite_email: "email",
  e_mail: "email",
  phone: "phone_number",
  mobile: "phone_number",
  tel: "phone_number",
  firstname: "first_name",
  lastname: "last_name",
  pass: "password",
  passwd: "password",
  ssn: "ssn",
  social_security: "ssn",

  // Email compound tokens
  external_email: "email",
  new_email: "email",
  comment_author_email: "email",
  staff_email: "email",
  author_email: "email",
  from_address: "email",
  normalizedemail: "email",
  usernameoremail: "email",

  // Password compound tokens
  user_pass: "password",
  share_password: "password",
  new_password: "password",
  plain: "password",

  // Username compound tokens
  user_login: "username",
  external_username: "username",
  user_nicename: "username",

  // Phone compound tokens
  fax: "phone_number",
  new_phone: "phone_number",

  // Date of birth
  birthday: "date_of_birth",
  bday: "date_of_birth",

  // National identifier
  social_security_number: "ssn",

  // Go / framework-specific compound tokens
  fieldnameemail: "email",

  // Bare field name — matched only with declaration context (see CONTEXT_GATED_ADDRESS_TOKENS)
  address: "address",
};

/** Tokens that map to password only in password-field context. */
export const CONTEXT_GATED_PASSWORD_TOKENS = new Set(["plain"]);

/** Tokens that map to address only when the line looks like a field declaration. */
export const CONTEXT_GATED_ADDRESS_TOKENS = new Set(["address"]);

const IDENTIFIER_TOKEN_RE = /(?<![a-zA-Z0-9_])(\$)?([a-zA-Z_][a-zA-Z0-9_]*)/g;

export function normalizeIdentifierToken(token: string): string {
  return token.trim().toLowerCase().replace(/-/g, "_");
}

/** Split camelCase / PascalCase identifiers into lower-case parts. */
export function splitCamelCaseParts(token: string): string[] {
  return token
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .split("_")
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

/** Lookup keys for a single identifier token (whole token + camelCase parts). */
export function identifierLookupKeys(token: string): string[] {
  const keys = new Set<string>();
  const normalized = normalizeIdentifierToken(token);
  keys.add(normalized);
  keys.add(normalized.replace(/_/g, ""));

  const snake = splitCamelCaseParts(token).join("_");
  keys.add(snake);
  keys.add(snake.replace(/_/g, ""));

  for (const part of splitCamelCaseParts(token)) {
    keys.add(part);
  }

  return [...keys];
}

export function lookupAliasRuleId(normalizedKey: string): string | undefined {
  return PII_SIGNAL_ALIASES[normalizedKey];
}

/**
 * True when a bare `address` token appears to name a declared field, not a
 * property access such as `aws_db_instance.main.address`.
 */
export function isBareAddressFieldDeclaration(
  line: string,
  tokenStartIndex: number,
): boolean {
  const before = line.slice(0, tokenStartIndex);
  if (before.endsWith(".") || /\.\s*$/.test(before)) {
    return false;
  }

  return (
    /\baddress\s*[=:;]/.test(line) ||
    /\b(?:String|CharField|TextField|varchar|text)\s+address\b/i.test(line) ||
    /\baddress\s*=\s*models\./i.test(line) ||
    /\bprivate\s+\w+\s+address\s*;/.test(line)
  );
}

export interface LineIdentifierToken {
  token: string;
  startIndex: number;
}

/** Extract identifier tokens from a source line (supports optional `$` prefix). */
export function extractLineIdentifierTokens(line: string): LineIdentifierToken[] {
  const tokens: LineIdentifierToken[] = [];
  IDENTIFIER_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IDENTIFIER_TOKEN_RE.exec(line)) !== null) {
    const token = match[2];
    if (!token) {
      continue;
    }
    tokens.push({
      token,
      startIndex: match.index + (match[1]?.length ?? 0),
    });
  }
  return tokens;
}

/** True when `Plain` names a password value inside a password field module. */
export function isPlainPasswordFieldDeclaration(line: string, filePath: string): boolean {
  if (!/\bPlain\b/.test(line)) {
    return false;
  }
  if (!/password/i.test(filePath)) {
    return false;
  }
  return /\bPlain\s+\w+/.test(line);
}

function suffixAliasRuleId(normalizedToken: string): string | undefined {
  for (const [aliasKey, ruleId] of Object.entries(PII_SIGNAL_ALIASES)) {
    if (
      CONTEXT_GATED_ADDRESS_TOKENS.has(aliasKey) ||
      CONTEXT_GATED_PASSWORD_TOKENS.has(aliasKey)
    ) {
      continue;
    }
    if (normalizedToken === aliasKey || normalizedToken.endsWith(`_${aliasKey}`)) {
      return ruleId;
    }
  }
  return undefined;
}

export function resolveAliasRuleIdsForToken(
  token: string,
  line: string,
  tokenStartIndex: number,
  filePath: string,
): string[] {
  const ruleIds = new Set<string>();
  for (const key of identifierLookupKeys(token)) {
    const ruleId = lookupAliasRuleId(key) ?? suffixAliasRuleId(key);
    if (!ruleId) {
      continue;
    }
    if (
      CONTEXT_GATED_ADDRESS_TOKENS.has(key) &&
      !isBareAddressFieldDeclaration(line, tokenStartIndex)
    ) {
      continue;
    }
    if (
      CONTEXT_GATED_PASSWORD_TOKENS.has(key) &&
      !isPlainPasswordFieldDeclaration(line, filePath)
    ) {
      continue;
    }
    ruleIds.add(ruleId);
  }
  return [...ruleIds];
}
