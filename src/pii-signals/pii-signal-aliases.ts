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

  // Accessor methods that imply stored personal-data fields
  getemail: "email",
  get_email: "email",
  getpassword: "password",
  get_password: "password",

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
    /\bprivate\s+\w+\s+address\s*;/.test(line) ||
    /\bvalidates(?:_\w+)*\s+:\w*address\b/i.test(line)
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

/**
 * Compound names that end in the email concept hold an address: `recipient_email`,
 * `customerEmail`, `to_emails`, `billing_email_address`. The line regex misses them
 * because `_` is a word character (KDATAP-c8a46a).
 */
function emailSuffixRuleId(token: string): string | undefined {
  const parts = splitCamelCaseParts(token);
  if (parts.length < 2) return undefined;
  const last = parts[parts.length - 1];
  const lastTwo = parts.slice(-2).join("_");
  return last === "email" || last === "emails" || lastTwo === "email_address" || lastTwo === "email_addresses"
    ? "email"
    : undefined;
}

/**
 * First words of flag and action names (`hideOrganizerEmail`, `noEmail`, `sendAwaitingPaymentEmail`,
 * `normalizeEmail`). Getters (`getDefaultEmail()`) and checks (`isEmail`, `validateEmail`) are
 * left out: in the labeled corpus they return or declare the address.
 */
const ACTION_OR_FLAG_FIRST_WORD = new Set([
  "has", "can", "should", "no", "hide", "show", "send", "set", "normalize", "disable", "enable", "use",
  "format", "extract", "fetch", "create", "update", "delete", "build", "handle", "mask", "sanitize", "allow", "skip", "resend",
]);

function namesActionOrType(token: string): boolean {
  const parts = splitCamelCaseParts(token);
  // A bare `mail` (`sendMail`) is governed by the mail-object rule below.
  const conceptWord = parts.some((part) => /^(?:emails?|phones?|mobile)$/.test(part));
  return parts.length > 1 && conceptWord && ACTION_OR_FLAG_FIRST_WORD.has(parts[0]);
}

/** Last words that make a phone-word identifier name something other than a phone number. */
const NOT_PHONE_LAST_WORD = new Set(["contact", "contacts", "format", "at", "webview", "sdk", "base", "view", "step"]);

/** A single `mail`, or a `mail` compound naming an address (`mail_from`, `reply_to_mail`). */
function MAIL_ADDRESS_COMPOUND(token: string): boolean {
  const parts = splitCamelCaseParts(token);
  return parts.length === 1 || parts.some((part) => MAIL_ADDRESS_WORD.has(part));
}
const MAIL_ADDRESS_WORD = new Set(["from", "to", "address", "addresses", "sender", "recipient", "recipients", "cc", "bcc", "reply"]);
/** A line that reads or sets an address field (`emailOptions.from`, `to:`) next to a mail compound. */
const MAIL_ADDRESS_ON_LINE = /(?:\.|\[\s*['"]|\b)(?:from|to|cc|bcc|reply_?to|sender)\b(?:['"]\s*\])?(?!\s*\()/i;

/** `mail` used as a constant, a call, or an object whose member is not an address list. */
const MAIL_OBJECT_USE = /^\s*(?:::|\(|\.(?!(?:to|from|cc|bcc|reply_to|sender|recipients)\b))/;

export function resolveAliasRuleIdsForToken(
  token: string,
  line: string,
  tokenStartIndex: number,
  filePath: string,
): string[] {
  const ruleIds = new Set<string>();
  const suffixRule = emailSuffixRuleId(token);
  if (suffixRule && !namesActionOrType(token)) ruleIds.add(suffixRule);
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
    // A phone word inside a longer name that ends in something else names that thing
    // (`existing_phone_number_contact`, `phone_number_format`, `allow_mobile_webview`), not a
    // phone number. Names ending in a holder of the value (`phone_source_id`, `phone_info`,
    // `PHONE_NUMBER_FIELD`) still count.
    // A multi-word PascalCase name (`MFAEnrollPhoneParams`, `MobileOtpType`) is a type or
    // class, never a phone value; ALL_CAPS constants (`ATTENDEE_PHONE_NUMBER_FIELD`) still count.
    if (
      ruleId === "phone_number" &&
      (NOT_PHONE_LAST_WORD.has(splitCamelCaseParts(token).slice(-1)[0] ?? "") ||
        (/^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(token) && splitCamelCaseParts(token).length > 1))
    ) {
      continue;
    }
    // A multi-word name that starts with a flag or action word names a flag or a function
    // (`hideOrganizerEmail`, `noEmail`, `normalizeEmail`, `sendSmsToPhone`), not a value.
    if ((ruleId === "email" || ruleId === "phone_number") && namesActionOrType(token)) {
      continue;
    }
    // `mail` inside a longer name is a mail message (`inbound_mail`, `mail_subject`,
    // `html_mail_body`) unless an address word goes with it (`mail_from`, `sender_mail`) or
    // the line reads an address field (`SendMailOptions['from']`).
    if (key === "mail" && !MAIL_ADDRESS_COMPOUND(token) && !MAIL_ADDRESS_ON_LINE.test(line)) {
      continue;
    }
    // A bare `mail` used as an object or constant (`Mail::Field`, `mail.to`, `mail(`) is
    // a mail message or mailer, not an address.
    if (key === "mail" && MAIL_OBJECT_USE.test(line.slice(tokenStartIndex + token.length))) {
      continue;
    }
    ruleIds.add(ruleId);
  }
  return [...ruleIds];
}
