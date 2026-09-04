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

const FUNCTION_DEF_PATTERNS = [
  /^\s*(export\s+)?(async\s+)?function\s+\w+/,
  /^\s*func\s+\w+/,
  /^\s*(public|private|protected|internal|static)\s+.*\([^)]*\)\s*[{;]/,
  /^\s*def\s+\w+/,
  /^\s*async\s+def\s+\w+/,
  /^\s*async\s+[_\w]+\s*\(/,
  /^\s*[_\w]+\s*=\s*(async\s+)?\([^)]*\)\s*=>/,
  /^\s*[_\w]+\s*=\s*function\s*\(/,
  /^\s*\w+\s*=\s*(async\s+)?\([^)]*\)\s*=>/,
  /^\s*\w+\s*=\s*function\s*\(/,
  /^\s*(public|private|protected|static|async)?\s*[_\w]+\s*\([^)]*\)\s*\{/,
  /^\s*(public|private|protected|static|async)?\s*[_\w]+\s*\([^)]*\)\s*$/,
  /^\s*(public|private|protected|internal|virtual|override|async|\s)+Task\s*<[^>]+>\s+\w+\s*\(/,
  /^\s*(public|private|protected|internal|virtual|override|async|\s)+Task\s+\w+\s*\(/,
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

function buildContextSpan(content: string, centerLine: number): string {
  const lines = content.split(/\r?\n/);
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

function shouldCollectCategoriesFromSpanOnly(span: string): boolean {
  return isRailsFileLevelDeclarationSpan(span);
}

function collectDataCategories(span: string, contextSpan: string): string[] {
  const categories = new Set<string>();
  const spanOnlyCategories = shouldCollectCategoriesFromSpanOnly(span);
  const inferContext = spanOnlyCategories ? span : contextSpan;

  if (!spanOnlyCategories && !isRubyAuthMethodSpan(span)) {
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

  return [...categories].sort((left, right) => left.localeCompare(right));
}

function intraComponentFlowType(span: string, contextSpan: string): DetectedDataFlow["type"] {
  if (/\b(?:check_password|try_to_login!?|find_by_login)\b/i.test(span)) {
    return "data_transfer";
  }

  if (isRailsFileLevelDeclarationSpan(span)) {
    if (/\bafter_(?:create|save|update)\s+:/i.test(span)) {
      return "database_query";
    }
    return "data_transfer";
  }

  const text = `${span}\n${contextSpan}`;
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

function coOccursInFunctionScope(span: string, scopeText: string): boolean {
  if (!hasStrongTransformationOnSpan(span)) {
    return false;
  }
  return (
    hasPersonalDataReference(span, scopeText) ||
    hasCustomerEntityInScope(scopeText, span)
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

function findEnclosingScope(
  lines: string[],
  lineIndex: number,
): { startLine: number; endLine: number; text: string } {
  const contextStart = Math.max(0, lineIndex - CONTEXT_LINE_RADIUS);
  const contextEnd = Math.min(lines.length - 1, lineIndex + CONTEXT_LINE_RADIUS);

  let scopeStart = lineIndex;
  let scopeEnd = lineIndex;

  for (let index = lineIndex; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (FUNCTION_DEF_PATTERNS.some((pattern) => pattern.test(line))) {
      scopeStart = index;
      break;
    }
    if (CLASS_DEF_PATTERNS.some((pattern) => pattern.test(line))) {
      scopeStart = index;
      break;
    }
  }

  const baseIndent = countIndent(lines[scopeStart] ?? "");
  let braceDepth = 0;
  let foundOpenBrace = false;

  for (let index = scopeStart; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const char of line) {
      if (char === "{") {
        braceDepth += 1;
        foundOpenBrace = true;
      } else if (char === "}") {
        braceDepth -= 1;
      }
    }

    scopeEnd = index;

    if (foundOpenBrace && braceDepth <= 0 && index > scopeStart) {
      break;
    }

    if (!foundOpenBrace && index > scopeStart) {
      const indent = countIndent(line);
      if (line.trim().length > 0 && indent <= baseIndent && index > lineIndex) {
        scopeEnd = index - 1;
        break;
      }
    }
  }

  return {
    startLine: scopeStart + 1,
    endLine: scopeEnd + 1,
    text: lines.slice(scopeStart, scopeEnd + 1).join("\n"),
  };
}

function transformationPriority(span: string, contextSpan: string): number {
  const text = `${span}\n${contextSpan}`;
  if (
    CRYPTO_AUTH_PATTERNS.some((pattern) => pattern.test(text)) &&
    /[\.(]|:=/.test(text)
  ) {
    return 4;
  }
  if (CRYPTO_AUTH_PATTERNS.some((pattern) => pattern.test(text))) {
    return 3;
  }
  if (PERSISTENCE_PATTERNS.some((pattern) => pattern.test(text))) {
    return 2;
  }
  if (isOrmModelSpan(span) || isOrmModelSpan(contextSpan)) {
    return 1;
  }
  return 0;
}

function transformationScore(span: string, contextSpan: string): number {
  let score = transformationPriority(span, contextSpan) * 1000;
  const text = `${span}\n${contextSpan}`;
  if (/GenerateFromPassword|DriverValue|\.Email\s*\(/i.test(text)) {
    score += 200;
  } else if (/bcrypt\.|\.save\s*\(/i.test(text)) {
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

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const spanLine = lineIndex + 1;
      const span = lines[lineIndex] ?? "";
      if (isCommentLine(span) || isImportOrLiteralLine(span)) {
        continue;
      }

      const contextSpan = buildContextSpan(file.content, spanLine);
      if (!hasIntraComponentTransformationEvidence(span, contextSpan)) {
        continue;
      }
      if (!spanAnchorsEvidence(span, contextSpan)) {
        continue;
      }
      const scope = findEnclosingScope(lines, lineIndex);

      if (isFileLevelDeclaration(span, contextSpan)) {
        if (isRouteDeclarationSpan(span, contextSpan) && !isRouteDeclarationWithPersonalData(span, contextSpan)) {
          continue;
        }
        const piiScope = isRouteDeclarationSpan(span, contextSpan)
          ? `${span}\n${contextSpan}`
          : isRailsFileLevelDeclarationSpan(span)
            ? span
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
      } else {
        if (!coOccursInFunctionScope(span, scope.text)) {
          continue;
        }
      }

      const flowType = intraComponentFlowType(span, contextSpan);
      const evidence = {
        filePath: file.path,
        startLine: spanLine,
        endLine: spanLine,
      };

      const component = resolveComponentForEvidence(components, evidence, {
        flowType,
        span,
        contextSpan,
      });
      if (!component) {
        continue;
      }

      const dedupeAnchorLine =
        isFileLevelDeclaration(span, contextSpan) || isRubyAuthMethodSpan(span)
          ? spanLine
          : scope.startLine;
      const key = dedupeKey(component.id, flowType, file.path, dedupeAnchorLine);
      const categories = collectDataCategories(span, contextSpan);
      const score = transformationScore(span, contextSpan);
      const candidate = {
        id: "",
        sourceComponentId: component.id,
        targetComponentId: component.id,
        type: flowType,
        confidence: INTRA_LINEAGE_CONFIDENCE,
        sourceLocation: {
          filePath: file.path,
          startLine: spanLine,
          endLine: spanLine,
          code: span.trim() || undefined,
        },
        dataCategories: categories,
        targetScope: "local" as const,
        targetScopeConfidence: "high" as const,
        targetScopeReason: "intra-component-lineage",
      };

      const existing = bestByKey.get(key);
      if (!existing || score > existing.score) {
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
