import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import type { FileInfo } from "../core/types/file";
import { loadPiiSignalRules } from "../pii-signals/pii-signal-rules";
import { resolveComponentForEvidence } from "./component-evidence-resolution";
import { normalizeProjectPath } from "./import-graph";
import {
  CRYPTO_AUTH_PATTERNS,
  hasIntraComponentTransformationEvidence,
  hasPersonalDataAssociationReference,
  hasStrongTransformationOnSpan,
  inferDataCategoriesFromSpan,
  inferFlowTypeFromSpan,
  findEnclosingPersonalDataRouteLine,
  hasPersonalDataRouteReference,
  isOrmModelSpan,
  isRailsFileLevelDeclarationSpan,
  isRouteDeclarationSpan,
  isRouteDeclarationWithPersonalData,
  PERSISTENCE_PATTERNS,
  piiRuleIdToDataCategory,
  ROUTE_DECLARATION_PATTERNS,
} from "./transformation-patterns";

const CONTEXT_LINE_RADIUS = 15;
const INTRA_LINEAGE_CONFIDENCE = 0.75;

const TEST_FILE_PATH_PATTERNS = [
  /_test\./i,
  /\.test\./i,
  /\.spec\./i,
  /\/tests?\//i,
  /\/__tests__\//i,
  /Test\.java$/i,
];

const PERSONAL_DATA_FIELD_PATTERNS = [
  /PasswordField/i,
  /PasswordFieldValue/i,
  /EmailField/i,
  /\.Email\s*\(/i,
  /TokenKey/i,
  /tokenKey/i,
  /PlainPassword/i,
  /user_pass/i,
];

const SCOPE_ENCLOSING_DEF_PATTERNS = [
  /^\s*(export\s+)?(async\s+)?function\s+\w+/,
  /^\s*func\s+\w+/,
  /^\s*constructor\s*\(/,
  /^\s*(?:public|private|protected|internal|static)\s+(?:async\s+)?\w+\s*\(/,
  /^\s*(?:public|private|protected|internal|static)\s+.*\([^)]*\)\s*:\s*[^{;]+\s*\{/,
  /^\s*(?:public|private|protected|internal|static)\s+.*\([^)]*\)\s*[{;]/,
  /^\s*(?:public|private|protected|internal|static|final|abstract)\s+function\s+\w+/,
  /^\s*def\s+self\.\w+/,
  /^\s*def\s+\w+/,
  /^\s*async\s+def\s+\w+/,
  /^\s*async\s+[_\w]+\s*\(/,
  /^\s*[_\w]+\s*=\s*(async\s+)?\([^)]*\)\s*=>/,
  /^\s*[_\w]+\s*=\s*function\s*\(/,
  /^\s*\w+\s*=\s*(async\s+)?\([^)]*\)\s*=>/,
  /^\s*\w+\s*=\s*function\s*\(/,
  /^\s*(public|private|protected|static|async)?\s*(?!if\b|while\b|for\b|switch\b|catch\b|elseif\b|else\b|foreach\b|do\b|unless\b|until\b)[_\w]+\s*\([^)]*\)\s*\{/,
  /^\s*(public|private|protected|internal|virtual|override|async|\s)+Task\s*<[^>]+>\s+\w+\s*\(/,
  /^\s*(public|private|protected|internal|virtual|override|async|\s)+Task\s+\w+\s*\(/,
];

const FUNCTION_DEF_PATTERNS = [
  ...SCOPE_ENCLOSING_DEF_PATTERNS,
  /^\s*(public|private|protected|static|async)?\s*(?!if\b|while\b|for\b|switch\b|catch\b|elseif\b|else\b|foreach\b|do\b|unless\b|until\b)[_\w]+\s*\([^)]*\)\s*$/,
];

const CLASS_DEF_PATTERNS = [
  /^\s*(export\s+)?class\s+\w+/,
  /^\s*class\s+\w+/,
  /^\s*module\s+\w+/,
  /^\s*interface\s+\w+/,
  /^\s*struct\s+\w+/,
];

function isTestFile(filePath: string): boolean {
  const normalized = normalizeProjectPath(filePath);
  return TEST_FILE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*")
  );
}

function buildContextSpan(lines: string[], centerLine: number): string {
  const start = Math.max(0, centerLine - 1 - CONTEXT_LINE_RADIUS);
  const end = Math.min(lines.length, centerLine + CONTEXT_LINE_RADIUS);
  return lines.slice(start, end).join("\n");
}

function hasPersonalDataReference(span: string, contextSpan: string): boolean {
  const text = `${span}\n${contextSpan}`;

  if (
    isRouteDeclarationSpan(span, contextSpan) &&
    isRouteDeclarationWithPersonalData(span, contextSpan)
  ) {
    return true;
  }

  for (const rule of loadPiiSignalRules()) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return true;
    }
  }

  if (PERSONAL_DATA_FIELD_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (inferDataCategoriesFromSpan(span, contextSpan).length > 0) {
    return true;
  }

  if (hasPersonalDataAssociationReference(span, contextSpan)) {
    return true;
  }

  return false;
}

function isRubyAuthMethodSpan(span: string): boolean {
  return /\b(?:check_password|try_to_login!?|find_by_login)\b/i.test(span);
}

function isAuthCredentialTransformationSpan(span: string): boolean {
  return (
    /->authenticate\s*\(/i.test(span) ||
    /customerAccountManagement->authenticate/i.test(span) ||
    /\bwp_signon\b/i.test(span) ||
    /\bwp_authenticate\b/i.test(span) ||
    /argon2\.verify/i.test(span) ||
    /bcrypt\.compare/i.test(span) ||
    /\b(?:hash_key|key_hash)\b/i.test(span) ||
    /ApiKey\.hash_key/i.test(span)
  );
}

function isAuthUserLookupSpan(span: string, contextSpan: string): boolean {
  const text = `${span}\n${contextSpan}`;
  return (
    /directus_users/i.test(text) &&
    /\.from\(|whereRaw|\.select\(/i.test(span)
  );
}

function normalizeFlowDataCategory(category: string): string {
  if (category === "email") {
    return "email_address";
  }
  return category;
}

function isPasswordVerificationSpan(span: string): boolean {
  return /argon2\.verify|bcrypt\.compare|wp_check_password|check_password/i.test(span);
}

function shouldCollectCategoriesFromSpanOnly(span: string, contextSpan: string): boolean {
  return (
    isRailsFileLevelDeclarationSpan(span) ||
    isRouteDeclarationSpan(span, contextSpan) ||
    isAuthUserLookupSpan(span, contextSpan) ||
    isPasswordVerificationSpan(span)
  );
}

function shouldSkipPiiRuleCategoryHarvest(span: string): boolean {
  return isRubyAuthMethodSpan(span) || isAuthCredentialTransformationSpan(span);
}

function shouldInferCategoriesFromSpanOnly(span: string, contextSpan: string): boolean {
  return (
    shouldCollectCategoriesFromSpanOnly(span, contextSpan) ||
    /argon2\.verify|bcrypt\.compare/i.test(span)
  );
}

function collectDataCategories(span: string, contextSpan: string): string[] {
  if (isAuthEmitterFilterSpan(span, contextSpan)) {
    const text = `${span}\n${contextSpan}`;
    const categories = new Set<string>();
    if (/password/i.test(text)) {
      categories.add("password");
    }
    if (/\bemail\b/i.test(text)) {
      categories.add("email");
    }
    return [...categories].sort((left, right) => left.localeCompare(right));
  }

  const categories = new Set<string>();
  const spanOnlyCategories = shouldCollectCategoriesFromSpanOnly(span, contextSpan);
  const inferContext = shouldInferCategoriesFromSpanOnly(span, contextSpan) ? span : contextSpan;

  if (!spanOnlyCategories && !shouldSkipPiiRuleCategoryHarvest(span)) {
    for (const rule of loadPiiSignalRules()) {
      if (rule.patterns.some((pattern) => pattern.test(span))) {
        categories.add(piiRuleIdToDataCategory(rule.id));
      }
    }
  }

  for (const category of inferDataCategoriesFromSpan(span, inferContext)) {
    categories.add(category);
  }

  if (/PasswordField|PasswordFieldValue|PlainPassword|GenerateFromPassword/i.test(span)) {
    categories.add("password");
  }
  if (/EmailField|\.Email\s*\(/i.test(span)) {
    categories.add("email");
  }
  if (/TokenKey|tokenKey/i.test(span)) {
    categories.add("access_token");
  }

  if (categories.size === 0) {
    if (/PasswordField|PasswordFieldValue|GenerateFromPassword/i.test(contextSpan)) {
      categories.add("password");
    }
    if (/EmailField|\.Email\s*\(/i.test(contextSpan)) {
      categories.add("email");
    }
  }

  return [...categories]
    .map(normalizeFlowDataCategory)
    .sort((left, right) => left.localeCompare(right));
}

function intraComponentFlowType(span: string, contextSpan: string): DetectedDataFlow["type"] {
  const text = `${span}\n${contextSpan}`;
  if (/emitter\.emitFilter\s*\(/i.test(span) && /auth\.login/i.test(text)) {
    return "database_query";
  }

  if (isUserCollectionBindingSpan(span)) {
    return "data_transfer";
  }

  if (
    isAuthCredentialTransformationSpan(span) ||
    isAuthUserLookupSpan(span, contextSpan) ||
    isPasswordVerificationSpan(span)
  ) {
    return "data_transfer";
  }

  if (/\b(?:check_password|try_to_login!?|find_by_login)\b/i.test(span)) {
    return "data_transfer";
  }

  if (isRailsFileLevelDeclarationSpan(span)) {
    if (/\bafter_(?:create|save|update)\s+:/i.test(span)) {
      return "database_query";
    }
    return "data_transfer";
  }

  if (isOrmModelSpan(span) || isOrmModelSpan(contextSpan)) {
    return inferFlowTypeFromSpan(span, contextSpan);
  }
  const inferred = inferFlowTypeFromSpan(span, contextSpan);
  if (inferred === "database_query") {
    return inferred;
  }
  if (
    inferred === "api_call" &&
    /sendEmailWithMagicLink|decodeToken|createCustomer|createCheckoutSession|this\.\w+Service|notificationHandler|SignInAsync|SignOutAsync/i.test(
      text,
    )
  ) {
    return inferred;
  }
  return "data_transfer";
}

function spanAnchorsEvidence(span: string, contextSpan: string): boolean {
  if (isFileLevelDeclaration(span, contextSpan)) {
    return true;
  }
  return hasStrongTransformationOnSpan(span);
}

function hasCustomerEntityInScope(scopeText: string, span: string): boolean {
  if (!/\bCustomer(?:Password)?\s+\w+/i.test(scopeText)) {
    return false;
  }
  return /repository\.\w*Insert/i.test(span) || /InsertCustomer/i.test(span);
}

function hasUserCollectionReference(span: string, scopeText: string): boolean {
  return /directus_users|super\(\s*['"]directus_users['"]/i.test(`${span}\n${scopeText}`);
}

function isUserCollectionBindingSpan(span: string): boolean {
  return /super\(\s*['"]directus_users['"]/i.test(span);
}

function isAuthEmitterFilterSpan(span: string, contextSpan: string): boolean {
  const text = `${span}\n${contextSpan}`;
  return /emitter\.emitFilter\s*\(/i.test(span) && /auth\.login/i.test(text);
}

function isWordPressAuthFunctionDefinitionSpan(span: string): boolean {
  return /^\s*function\s+(?:wp_(?:authenticate(?:_application_password|_username_password)?|check_password|hash_password|set_password|signon|create_user|get_user|set_auth_cookie|validate_auth_cookie|clear_auth_cookie|get_current_user|validate_application_password)|get_users|check_password_reset_key|username_exists|email_exists)\b/i.test(
    span,
  );
}

function isWordPressAuthCallSpan(span: string): boolean {
  return /\b(?:wp_(?:authenticate|check_password|hash_password|set_password|signon|create_user|set_auth_cookie|generate_auth_cookie|get_users)|get_user_by|check_password_reset_key)\s*\(/i.test(
    span,
  ) || /::hash_password\s*\(/i.test(span);
}

function isHighSignalPersonalDataTransformationSpan(span: string): boolean {
  return (
    /sendPasswordReset|createValidator\s*\(\s*['"]customer['"]\s*,\s*['"]save['"]\s*\)|processAuthenticationFailure/i.test(
      span,
    ) || isWordPressAuthCallSpan(span)
  );
}

function coOccursInFunctionScope(span: string, scopeText: string, contextSpan: string): boolean {
  if (!hasStrongTransformationOnSpan(span)) {
    return false;
  }
  if (isUserCollectionBindingSpan(span) || isAuthEmitterFilterSpan(span, contextSpan)) {
    return true;
  }
  if (isHighSignalPersonalDataTransformationSpan(span)) {
    return true;
  }
  return (
    hasPersonalDataReference(span, scopeText) ||
    hasCustomerEntityInScope(scopeText, span) ||
    hasUserCollectionReference(span, scopeText)
  );
}

function isImportOrLiteralLine(span: string): boolean {
  const trimmed = span.trim();
  if (/^export\s+\*\s+from/i.test(trimmed)) {
    return false;
  }
  if (/^import\s/.test(trimmed)) {
    return true;
  }
  if (/^["'][^"']*["'],?\s*$/.test(trimmed)) {
    return true;
  }
  return false;
}

function isFileLevelDeclaration(span: string, contextSpan: string): boolean {
  const text = `${span}\n${contextSpan}`;
  if (ROUTE_DECLARATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  if (isRailsFileLevelDeclarationSpan(span)) {
    return true;
  }
  if (isWordPressAuthFunctionDefinitionSpan(span)) {
    return true;
  }
  if (
    isOrmModelSpan(span) &&
    /EmailField|PasswordField|PlainPassword|user_pass/i.test(span)
  ) {
    return true;
  }
  return false;
}

function countIndent(line: string): number {
  const match = line.match(/^(\s*)/);
  return match ? match[1].replace(/\t/g, "  ").length : 0;
}

type EnclosingScope = { startLine: number; endLine: number; readonly text: string };

/**
 * The enclosing scope of each line of one file, in O(n log n) per file.
 *
 * A line with no scope header above it is its own scope start, so a file without
 * function or class headers (a generated PHP baseline, a config array) has one scope
 * per line, each running to the end of the file. Caching the joined text of those
 * scopes kept O(lines^2) bytes alive and exhausted the heap on a 1.7 MB file. Only scope
 * end lines are cached; `text` is joined on read and only for lines that need it. Scope
 * ends come from a min segment tree over brace depth and a per-indent index of Ruby
 * `end` lines, so no lookup scans forward through the file.
 */
export function enclosingScopeFinder(lines: string[]): (lineIndex: number) => EnclosingScope {
  const nearestHeader: number[] = new Array(lines.length);
  let last = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (
      SCOPE_ENCLOSING_DEF_PATTERNS.some((pattern) => pattern.test(line)) ||
      CLASS_DEF_PATTERNS.some((pattern) => pattern.test(line))
    ) {
      last = index;
    }
    nearestHeader[index] = last;
  }
  const findScopeEnd = scopeEndFinder(lines);
  // Scope start -> last line index of the scope; null for a Ruby scope without its `end`.
  const ends = new Map<number, number | null>();
  return (lineIndex) => {
    const header = nearestHeader[lineIndex] ?? -1;
    const scopeStart = header >= 0 ? header : lineIndex;
    let end = ends.get(scopeStart);
    if (end === undefined) {
      end = findScopeEnd(scopeStart);
      ends.set(scopeStart, end);
    }
    // A Ruby scope without its closing `end` ends at the line asked about.
    const scopeEnd = end ?? lineIndex;
    return {
      startLine: scopeStart + 1,
      endLine: scopeEnd + 1,
      get text() {
        return lines.slice(scopeStart, scopeEnd + 1).join("\n");
      },
    };
  };
}

/**
 * Last line index of the scope that starts at `scopeStart`, or null for a Ruby scope
 * without a matching `end`.
 *
 * Brace scopes: the body starts at the first line at or after the scope start that holds
 * a `{` and ends at the first later line where the running brace depth, counted from the
 * body start, is back to zero or below. Without such a line (or without any `{`) the
 * scope runs to the end of the file. Ruby scopes (`def`/`class`/`module`) end at the first
 * later `end` line with the same indent.
 */
function scopeEndFinder(lines: string[]): (scopeStart: number) => number | null {
  const count = lines.length;
  const lastIndex = count - 1;
  // depthAfter[i]: net `{` minus `}` over lines 0..i.
  const depthAfter = new Int32Array(count);
  // nextOpenLine[i]: first line index >= i that holds a `{`, or -1.
  const nextOpenLine = new Int32Array(count + 1);
  let depth = 0;
  for (let index = 0; index < count; index += 1) {
    const line = lines[index] ?? "";
    for (let offset = 0; offset < line.length; offset += 1) {
      const code = line.charCodeAt(offset);
      if (code === 123) depth += 1;
      else if (code === 125) depth -= 1;
    }
    depthAfter[index] = depth;
  }
  nextOpenLine[count] = -1;
  for (let index = count - 1; index >= 0; index -= 1) {
    nextOpenLine[index] = (lines[index] ?? "").includes("{") ? index : nextOpenLine[index + 1]!;
  }
  const firstDepthAtMost = firstAtMostFinder(depthAfter);
  let rubyEndsByIndent: Map<number, number[]> | undefined;

  return (scopeStart) => {
    const scopeLine = lines[scopeStart] ?? "";
    if (/^\s*(?:def|class|module)\s+/.test(scopeLine)) {
      rubyEndsByIndent ??= rubyEndLinesByIndent(lines);
      const candidates = rubyEndsByIndent.get(countIndent(scopeLine)) ?? [];
      const position = firstGreaterThan(candidates, scopeStart);
      return position < candidates.length ? candidates[position]! : null;
    }
    const bodyStart = nextOpenLine[scopeStart]!;
    if (bodyStart < 0 || bodyStart >= lastIndex) {
      return lastIndex;
    }
    const depthBeforeBody = bodyStart > 0 ? depthAfter[bodyStart - 1]! : 0;
    const closing = firstDepthAtMost(bodyStart + 1, depthBeforeBody);
    return closing >= 0 ? closing : lastIndex;
  };
}

function rubyEndLinesByIndent(lines: string[]): Map<number, number[]> {
  const byIndent = new Map<number, number[]>();
  lines.forEach((line, index) => {
    if (!/^\s*end\b/.test(line)) return;
    const indent = countIndent(line);
    const list = byIndent.get(indent);
    if (list) list.push(index);
    else byIndent.set(indent, [index]);
  });
  return byIndent;
}

/** Position of the first value in ascending `values` that is greater than `target`. */
function firstGreaterThan(values: number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle]! > target) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * Returns a lookup for the first index >= `from` whose value is <= `limit` (or -1), in
 * O(log n) per lookup over a min segment tree.
 */
function firstAtMostFinder(values: Int32Array): (from: number, limit: number) => number {
  let size = 1;
  while (size < values.length) size *= 2;
  const tree = new Int32Array(size * 2).fill(0x7fffffff);
  tree.set(values, size);
  for (let node = size - 1; node >= 1; node -= 1) {
    tree[node] = Math.min(tree[node * 2]!, tree[node * 2 + 1]!);
  }
  const search = (node: number, low: number, high: number, from: number, limit: number): number => {
    if (high < from || tree[node]! > limit) return -1;
    if (low === high) return low;
    const middle = (low + high) >> 1;
    const left = search(node * 2, low, middle, from, limit);
    return left >= 0 ? left : search(node * 2 + 1, middle + 1, high, from, limit);
  };
  return (from, limit) => (from >= values.length ? -1 : search(1, 0, size - 1, from, limit));
}

function isClassScopeLine(line: string): boolean {
  return CLASS_DEF_PATTERNS.some((pattern) => pattern.test(line));
}

function isScopeHeaderSpan(span: string): boolean {
  return SCOPE_ENCLOSING_DEF_PATTERNS.some((pattern) => pattern.test(span));
}

/**
 * Skip method/function header lines that only borrow auth keywords from the
 * identifier. They should not consume the per-scope dedupe slot ahead of the
 * real transformation line inside the body.
 */
function isBareScopeHeaderSpan(span: string, contextSpan: string): boolean {
  if (!isScopeHeaderSpan(span)) {
    return false;
  }
  if (isRouteDeclarationSpan(span, contextSpan) || isRailsFileLevelDeclarationSpan(span)) {
    return false;
  }
  if (isWordPressAuthFunctionDefinitionSpan(span)) {
    return false;
  }
  if (/^\s*(?:async\s+)?def\s+/.test(span)) {
    return false;
  }
  if (/->|=>|=\s*(?:\$this->|\w+::)/.test(span)) {
    return false;
  }
  return true;
}

function isSpanAnchoredDedupeSpan(span: string, contextSpan: string): boolean {
  if (isUserCollectionBindingSpan(span) || isAuthEmitterFilterSpan(span, contextSpan)) {
    return true;
  }
  return (
    isUserCollectionBindingSpan(span) ||
    isAuthEmitterFilterSpan(span, contextSpan) ||
    isWordPressAuthFunctionDefinitionSpan(span) ||
    isWordPressAuthCallSpan(span) ||
    /session->logout|->createAccount\(|sendPasswordResetConfirmationEmail|createValidator\s*\(\s*['"]customer['"]/i.test(
      span,
    )
  );
}

function shouldPreferCandidateFlow(
  candidateSpan: string,
  candidateLine: number,
  existingSpan: string,
  existingLine: number,
  score: number,
  existingScore: number,
): boolean {
  if (score > existingScore) {
    return true;
  }
  if (score < existingScore) {
    return false;
  }

  const candidateHeader = isScopeHeaderSpan(candidateSpan);
  const existingHeader = isScopeHeaderSpan(existingSpan);
  if (candidateHeader && !existingHeader) {
    return true;
  }
  if (!candidateHeader && existingHeader) {
    return false;
  }

  return candidateLine > existingLine;
}

function transformationPriority(span: string, contextSpan: string): number {
  if (
    CRYPTO_AUTH_PATTERNS.some((pattern) => pattern.test(span)) &&
    /[\.(]|:=/.test(span)
  ) {
    return 4;
  }
  if (CRYPTO_AUTH_PATTERNS.some((pattern) => pattern.test(span))) {
    return 3;
  }
  if (PERSISTENCE_PATTERNS.some((pattern) => pattern.test(span))) {
    return 2;
  }
  if (isOrmModelSpan(span) || isOrmModelSpan(contextSpan)) {
    return 1;
  }
  return 0;
}

function transformationScore(span: string, contextSpan: string): number {
  if (isWordPressAuthFunctionDefinitionSpan(span)) {
    return 5000;
  }
  let score = transformationPriority(span, contextSpan) * 1000;
  if (/GenerateFromPassword|DriverValue|\.Email\s*\(/i.test(span)) {
    score += 200;
  } else if (/customerAccountManagement->authenticate|->authenticate\s*\(/i.test(span)) {
    score += 300;
  } else if (/session->logout|->createAccount\(|sendPasswordResetConfirmationEmail/i.test(span)) {
    score += 250;
  } else if (isWordPressAuthCallSpan(span)) {
    score += 200;
  } else if (/bcrypt\.|\.save\s*\(/i.test(span)) {
    score += 100;
  }
  return score;
}

function dedupeKey(
  componentId: string,
  type: DetectedDataFlow["type"],
  filePath: string,
  anchorLine: number,
): string {
  return `${componentId}\t${type}\t${normalizeProjectPath(filePath)}\t${anchorLine}`;
}

export function detectIntraComponentLineage(
  files: FileInfo[],
  components: DetectedComponent[],
  startIndex: number,
): { flows: DetectedDataFlow[]; nextIndex: number } {
  const flows: DetectedDataFlow[] = [];
  const bestByKey = new Map<
    string,
    { flow: DetectedDataFlow; score: number }
  >();
  let flowIndex = startIndex;

  for (const file of files) {
    if (isTestFile(file.path)) {
      continue;
    }

    const lines = file.content.split(/\r?\n/);
    const enclosingScope = enclosingScopeFinder(lines);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const spanLine = lineIndex + 1;
      const span = lines[lineIndex] ?? "";
      if (isCommentLine(span) || isImportOrLiteralLine(span)) {
        continue;
      }

      const contextSpan = buildContextSpan(lines, spanLine);
      if (isBareScopeHeaderSpan(span, contextSpan)) {
        continue;
      }
      const scope = enclosingScope(lineIndex);
      const enclosingRouteLine = findEnclosingPersonalDataRouteLine(lines, lineIndex);
      const insidePersonalDataRouteBlock =
        enclosingRouteLine !== undefined && spanLine > enclosingRouteLine;

      let flowSpan = span;
      let flowContextSpan = contextSpan;

      if (insidePersonalDataRouteBlock) {
        flowSpan = lines[enclosingRouteLine - 1] ?? "";
        flowContextSpan = buildContextSpan(lines, enclosingRouteLine);
        if (!hasPersonalDataRouteReference(flowSpan, flowContextSpan)) {
          continue;
        }
        if (!hasStrongTransformationOnSpan(flowSpan)) {
          continue;
        }
      } else {
        if (!hasIntraComponentTransformationEvidence(span, contextSpan)) {
          continue;
        }
        if (!spanAnchorsEvidence(span, contextSpan)) {
          continue;
        }

        if (isFileLevelDeclaration(span, contextSpan)) {
          if (isRouteDeclarationSpan(span, contextSpan) && !isRouteDeclarationWithPersonalData(span, contextSpan)) {
            continue;
          }
          const piiScope = isRouteDeclarationSpan(span, contextSpan)
            ? `${span}\n${contextSpan}`
          : isRailsFileLevelDeclarationSpan(span)
            ? `${span}\n${contextSpan}`
            : isWordPressAuthFunctionDefinitionSpan(span)
              ? `${span}\n${contextSpan}`
              : contextSpan;
          if (
            !hasPersonalDataReference(span, piiScope) &&
            !hasPersonalDataAssociationReference(span, piiScope)
          ) {
            continue;
          }
          if (!hasStrongTransformationOnSpan(span)) {
            continue;
          }
        } else if (!coOccursInFunctionScope(span, scope.text, contextSpan)) {
          continue;
        }
      }

      const fileLevelFlow =
        insidePersonalDataRouteBlock ||
        isFileLevelDeclaration(span, contextSpan) ||
        isRubyAuthMethodSpan(span);

      const flowType = intraComponentFlowType(flowSpan, flowContextSpan);
      let evidenceStartLine = spanLine;
      let evidenceEndLine = spanLine;
      if (insidePersonalDataRouteBlock) {
        evidenceStartLine = enclosingRouteLine;
        evidenceEndLine = Math.max(spanLine, scope.endLine);
      } else if (!fileLevelFlow && !isClassScopeLine(lines[scope.startLine - 1] ?? "")) {
        evidenceEndLine = Math.max(spanLine, scope.endLine);
      }

      const evidence = {
        filePath: file.path,
        startLine: evidenceStartLine,
        endLine: evidenceEndLine,
      };

      const component = resolveComponentForEvidence(components, evidence, {
        flowType,
        span: flowSpan,
        contextSpan: flowContextSpan,
      });
      if (!component) {
        continue;
      }

      const dedupeAnchorLine = fileLevelFlow
        ? insidePersonalDataRouteBlock
          ? enclosingRouteLine
          : spanLine
        : isSpanAnchoredDedupeSpan(span, contextSpan)
          ? spanLine
          : scope.startLine;
      const key = dedupeKey(component.id, flowType, file.path, dedupeAnchorLine);
      const categories = collectDataCategories(flowSpan, flowContextSpan);
      const score = transformationScore(flowSpan, flowContextSpan);
      const candidate = {
        id: "",
        sourceComponentId: component.id,
        targetComponentId: component.id,
        type: flowType,
        confidence: INTRA_LINEAGE_CONFIDENCE,
        sourceLocation: {
          filePath: file.path,
          startLine: evidenceStartLine,
          endLine: evidenceEndLine,
          code: flowSpan.trim() || span.trim() || undefined,
        },
        dataCategories: categories,
        targetScope: "local" as const,
        targetScopeConfidence: "high" as const,
        targetScopeReason: "intra-component-lineage",
      };

      const existing = bestByKey.get(key);
      const existingAnchorLine = existing?.flow.sourceLocation?.startLine ?? 0;
      const existingSpan = existing?.flow.sourceLocation?.code ?? "";
      if (
        !existing ||
        shouldPreferCandidateFlow(
          flowSpan,
          spanLine,
          existingSpan,
          existingAnchorLine,
          score,
          existing.score,
        )
      ) {
        bestByKey.set(key, {
          flow: candidate,
          score,
        });
      }
    }
  }

  for (const entry of [...bestByKey.values()].sort((left, right) =>
    left.flow.sourceLocation!.filePath.localeCompare(right.flow.sourceLocation!.filePath),
  )) {
    flowIndex += 1;
    flows.push({
      ...entry.flow,
      id: `flow_${flowIndex}`,
    });
  }

  return { flows, nextIndex: flowIndex };
}
