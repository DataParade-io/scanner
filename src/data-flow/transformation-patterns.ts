import type { DataFlowType } from "../core/types/data-flow";

export const ORM_PATTERNS = [
  /models\./i,
  /CharField/i,
  /TextField/i,
  /IntegerField/i,
  /Column\s*\(/i,
  /@Column/i,
  /db\.Column/i,
  /ForeignKey/i,
  /Model\s*\)/i,
  /class\s+\w+\([^)]*Model/i,
  /Schema::/i,
  /protected\s+\$/i,
];

export const PERSISTENCE_PATTERNS = [
  /\.save\s*\(/i,
  /\.create\s*\(/i,
  /\.insert/i,
  /\.update\s*\(/i,
  /wp_insert_user/i,
  /wp_hash_password/i,
  /persist/i,
  /INSERT INTO/i,
  /UPDATE\s+/i,
  /DriverValue/i,
];

export const CRYPTO_AUTH_PATTERNS = [
  /bcrypt/i,
  /\bhash\b/i,
  /GenerateFromPassword/i,
  /\bjwt\b/i,
  /JWT/i,
  /\bsign\s*\(/i,
  /\.sign\s*\(/i,
  /encrypt/i,
  /decrypt/i,
  /tokenKey/i,
  /TokenKey/i,
  /wp_signon/i,
  /wp_set_auth_cookie/i,
  /set_auth_cookie/i,
  /authenticate/i,
  /signon/i,
  /session_token/i,
  /session_tokens/i,
  /setCustomerDataAsLoggedIn/i,
  /PlainPassword/i,
];

export const CROSS_BOUNDARY_PATTERNS = [
  /\bfetch\b/i,
  /\bhttp/i,
  /axios/i,
  /requests\./i,
  /\.get\s*\(/i,
  /\.post\s*\(/i,
  /webhook/i,
  /kafka/i,
  /\bqueue\b/i,
  /\bcurl\b/i,
  /grpc/i,
  /HttpClient/i,
  /wp_remote_/i,
];

const DECLARATION_ONLY_LINE_PATTERNS = [
  /^\s*\w[\w.-]*:\s*[\w.-]+\s*$/,
  /^\s*\w[\w.-]*:\s*$/,
  /^\s*interface\s+\w+/,
  /^\s*(public|private|protected|val|var)\s+\w+/,
  /^\s*function\s+\w+\s*\([^)]*\)\s*\{?\s*$/,
  /^\s*\w+\s+\w+\s*`/,
  /^\s*\w+\s+\w+(\s+\/\/.*)?\s*$/,
  /^\s*\/\//,
  /^\s*\/\*/,
  /^\s*\*\s/,
];

function isCommentOrBlankLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("//") || trimmed.startsWith("#");
}

export function isDeclarationOnlySpan(span: string): boolean {
  const lines = span.split("\n").filter((line) => !isCommentOrBlankLine(line));
  if (lines.length === 0) {
    return true;
  }

  return lines.every((line) =>
    DECLARATION_ONLY_LINE_PATTERNS.some((pattern) => pattern.test(line)),
  );
}

export function isOrmModelSpan(span: string): boolean {
  return ORM_PATTERNS.some((pattern) => pattern.test(span));
}

export function hasCrossBoundaryEvidence(span: string, contextSpan: string): boolean {
  const text = `${span}\n${contextSpan}`;
  return CROSS_BOUNDARY_PATTERNS.some((pattern) => pattern.test(text));
}

export function hasIntraComponentTransformationEvidence(
  span: string,
  contextSpan: string,
): boolean {
  const text = `${span}\n${contextSpan}`;

  if (ORM_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (CRYPTO_AUTH_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (PERSISTENCE_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (isDeclarationOnlySpan(span)) {
    return false;
  }
  if (hasCrossBoundaryEvidence(span, contextSpan)) {
    return false;
  }
  return false;
}

const FLOW_TYPE_PATTERNS: Array<{ type: DataFlowType; patterns: RegExp[] }> = [
  {
    type: "api_call",
    patterns: [
      /\bfetch\b/i,
      /\bhttp/i,
      /axios/i,
      /requests\./i,
      /\.get\s*\(/i,
      /\.post\s*\(/i,
      /wp_remote_/i,
    ],
  },
  {
    type: "database_query",
    patterns: [
      /\bsql\b/i,
      /CharField/i,
      /Column\s*\(/i,
      /INSERT/i,
      /UPDATE/i,
      /\.save\s*\(/i,
      /wpdb/i,
      /models\./i,
      /DriverValue/i,
    ],
  },
  {
    type: "message_queue",
    patterns: [/\bqueue\b/i, /\btopic\b/i, /kafka/i, /rabbitmq/i, /sqs/i],
  },
  {
    type: "file_transfer",
    patterns: [/\bupload\b/i, /\bdownload\b/i, /\bstorage\b/i],
  },
  { type: "webhook", patterns: [/\bwebhook\b/i] },
  { type: "rpc", patterns: [/\bgrpc\b/i, /\brpc\b/i] },
];

export function hasStrongTransformationOnSpan(span: string): boolean {
  return (
    CRYPTO_AUTH_PATTERNS.some((pattern) => pattern.test(span)) ||
    PERSISTENCE_PATTERNS.some((pattern) => pattern.test(span)) ||
    isOrmModelSpan(span)
  );
}

export function inferFlowTypeFromSpan(span: string, contextSpan: string): DataFlowType {
  const text = `${span}\n${contextSpan}`;
  for (const entry of FLOW_TYPE_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.type;
    }
  }
  return "data_transfer";
}

const DATA_CATEGORY_PATTERNS: Array<{ category: string; patterns: RegExp[] }> = [
  { category: "password", patterns: [/\bpassword\b/i, /\bpasswd\b/i, /user_pass/i, /PlainPassword/i] },
  { category: "email", patterns: [/\bemail\b/i] },
  { category: "access_token", patterns: [/\baccess_token\b/i, /\bid_token\b/i] },
  { category: "session", patterns: [/\bsession\b/i, /\bcookie\b/i] },
  { category: "social_security_number", patterns: [/\bssn\b/i, /social_security/i] },
  { category: "phone_number", patterns: [/\bphone\b/i] },
  { category: "address", patterns: [/\baddress\b/i] },
  { category: "payment_card", patterns: [/\bcard\b/i, /\bpayment\b/i] },
];

const PII_RULE_ID_TO_CATEGORY: Record<string, string> = {
  email: "email",
  password: "password",
  ssn: "social_security_number",
  address: "address",
  phone_number: "phone_number",
  username: "username",
  first_name: "first_name",
  last_name: "last_name",
  full_name: "full_name",
  date_of_birth: "date_of_birth",
  passport: "passport_number",
  national_id: "national_id",
  drivers_license: "drivers_license_number",
  tax_id: "tax_identifier",
  account_number: "account_number",
};

export function piiRuleIdToDataCategory(ruleId: string): string {
  return PII_RULE_ID_TO_CATEGORY[ruleId] ?? ruleId;
}

export function inferDataCategoriesFromSpan(span: string, contextSpan: string): string[] {
  const text = `${span}\n${contextSpan}`;
  const categories = new Set<string>();
  for (const entry of DATA_CATEGORY_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      categories.add(entry.category);
    }
  }
  return [...categories].sort((left, right) => left.localeCompare(right));
}
