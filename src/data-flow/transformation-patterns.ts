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
  /hash_password/i,
  /hashPassword/i,
  /key_hash/i,
  /tokenhash/i,
  /wp_check_password/i,
  /wp_hash_password/i,
  /wp_set_password/i,
  /argon2/i,
];

export const ROUTE_DECLARATION_PATTERNS = [
  /<route\s+url=/i,
  /soapOperation=/i,
  /^\s*(get|post|put|delete|patch)\s+['"][^'"]+['"]\s*=>/i,
];

export const MODEL_ASSOCIATION_PATTERNS = [
  /\bhas_one\s+:/i,
  /\bhas_many\s+:/i,
  /\bbelongs_to\s+:/i,
  /\bafter_create\s+:/i,
  /\bafter_save\s+:/i,
  /\bafter_update\s+:/i,
  /\bscope\s+:\w+\s*,/i,
  /\bvalidates\s+:/i,
  /\bnormalizes\s+:/i,
  /<\s*ActiveRecord::Base/i,
];

export const LOOKUP_PATTERNS = [
  /\bfind_by_\w+/i,
  /\bfind_active_user/i,
  /\bFindRecordById/i,
  /\bGetCustomerBy\w+Async/i,
  /\bGetUserBy\w+/i,
  /GetCustomerByEmail/i,
  /GetCustomerByUsername/i,
  /getbytoken/i,
  /\.whereRaw\s*\(/i,
  /\.first\s*\(/i,
  /->where\s*\(/i,
  /->query\s*\(/i,
  /\.query\s*\(\s*['"]/i,
  /SELECT\s+\*/i,
  /strapi\.db\.query/i,
];

export const MODULE_REEXPORT_PATTERNS = [
  /export\s*\*\s*from/i,
  /export\s+default\s+\w+/i,
  /discoveryPath\s*=/i,
];

export const PASSWORD_HASH_PATTERNS_ADDENDUM = [
  /\bargon2\b/i,
  /hash_key/i,
  /key_hash/i,
  /tokenhash/i,
  /hash_password/i,
  /hashPassword/i,
  /setPassword/i,
  /resetPassword/i,
  /validatePassword/i,
  /verifyPassword/i,
  /wp_check_password/i,
  /wp_generate_password/i,
  /wp_set_password/i,
  /wp_hash_password/i,
  /UserPasswordValidator/i,
];

export const ORM_PERSISTENCE_PATTERNS_ADDENDUM = [
  /\.create\w*\s*\(/i,
  /\.save\w*\s*\(/i,
  /\.insert\w*\s*\(/i,
  /\.update\w*\s*\(/i,
  /->save\w*\s*\(/i,
  /->create\w*\s*\(/i,
  /model\.text\s*\(/i,
  /model\.define/i,
  /create_api_token/i,
  /repository\.insert/i,
  /repository\.save/i,
  /entityService\.(create|update)/i,
];

export const SESSION_COOKIE_PATTERNS_ADDENDUM = [
  /SignOutAsync/i,
  /SignInAsync/i,
  /session->logout/i,
  /session_store/i,
  /sessionStore/i,
  /setSession/i,
  /createSession/i,
  /session_regenerate/i,
  /set_session/i,
  /WP_Session_Tokens/i,
  /SaveAsync/i,
];

export const AUTH_FUNCTION_PATTERNS_ADDENDUM = [
  /function\s+wp_authenticate/i,
  /function\s+wp_check_password/i,
  /function\s+wp_create_user/i,
  /function\s+wp_set_password/i,
  /function\s+check_password_reset_key/i,
  /get_user_by\s*\(/i,
  /\bget_users\s*\(/i,
  /this\.\w*Service\.\w+/i,
  /this\._sendEmail/i,
  /sendEmailWithMagicLink/i,
  /decodeToken/i,
  /createCheckoutSession/i,
  /createCustomer/i,
  /sendTemplatedEmail/i,
  /sendPasswordReset/i,
  /notificationHandler/i,
];

const ALL_TRANSFORMATION_PATTERN_GROUPS: RegExp[][] = [
  ORM_PATTERNS,
  CRYPTO_AUTH_PATTERNS,
  PERSISTENCE_PATTERNS,
  ROUTE_DECLARATION_PATTERNS,
  MODEL_ASSOCIATION_PATTERNS,
  LOOKUP_PATTERNS,
  MODULE_REEXPORT_PATTERNS,
  PASSWORD_HASH_PATTERNS_ADDENDUM,
  ORM_PERSISTENCE_PATTERNS_ADDENDUM,
  SESSION_COOKIE_PATTERNS_ADDENDUM,
  AUTH_FUNCTION_PATTERNS_ADDENDUM,
];

const STRONG_TRANSFORMATION_PATTERN_GROUPS: RegExp[][] = [
  CRYPTO_AUTH_PATTERNS,
  PERSISTENCE_PATTERNS,
  ORM_PATTERNS,
  ROUTE_DECLARATION_PATTERNS,
  MODEL_ASSOCIATION_PATTERNS,
  LOOKUP_PATTERNS,
  MODULE_REEXPORT_PATTERNS,
  PASSWORD_HASH_PATTERNS_ADDENDUM,
  ORM_PERSISTENCE_PATTERNS_ADDENDUM,
  SESSION_COOKIE_PATTERNS_ADDENDUM,
  AUTH_FUNCTION_PATTERNS_ADDENDUM,
];

const PERSONAL_DATA_ROUTE_PATH_PATTERNS = [
  /customer/i,
  /user/i,
  /password/i,
  /account/i,
  /session/i,
];

export function hasPersonalDataRouteReference(span: string, contextSpan: string): boolean {
  const text = `${span}\n${contextSpan}`;
  return PERSONAL_DATA_ROUTE_PATH_PATTERNS.some((pattern) => pattern.test(text));
}

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

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
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

export function isRouteDeclarationSpan(span: string, contextSpan: string): boolean {
  const text = `${span}\n${contextSpan}`;
  return ROUTE_DECLARATION_PATTERNS.some((pattern) => pattern.test(text));
}

export function isRouteDeclarationWithPersonalData(span: string, contextSpan: string): boolean {
  if (!isRouteDeclarationSpan(span, contextSpan)) {
    return false;
  }
  return hasPersonalDataRouteReference(span, contextSpan);
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

  if (matchesAnyPattern(text, ALL_TRANSFORMATION_PATTERN_GROUPS.flat())) {
    if (isRouteDeclarationSpan(span, contextSpan) && !isRouteDeclarationWithPersonalData(span, contextSpan)) {
      return false;
    }
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
      /<route\s+url=/i,
      /^\s*(get|post|put|delete|patch)\s+['"][^'"]+['"]\s*=>/i,
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
      /\bhas_one\s+:/i,
      /\bhas_many\s+:/i,
      /\bbelongs_to\s+:/i,
      /\bfind_by_\w+/i,
      /\.whereRaw\s*\(/i,
      /SELECT\s+\*/i,
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

export function hasStrongTransformationOnSpan(span: string, contextSpan?: string): boolean {
  if (matchesAnyPattern(span, STRONG_TRANSFORMATION_PATTERN_GROUPS.flat())) {
    return true;
  }
  if (contextSpan) {
    return matchesAnyPattern(contextSpan, STRONG_TRANSFORMATION_PATTERN_GROUPS.flat());
  }
  return false;
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
  {
    category: "password",
    patterns: [
      /\bpassword\b/i,
      /password/i,
      /\bpasswd\b/i,
      /user_pass/i,
      /PlainPassword/i,
      /hash_password/i,
      /hashPassword/i,
    ],
  },
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
