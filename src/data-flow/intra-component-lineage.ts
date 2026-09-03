import type { DetectedComponent } from "../core/types/component";
import type { DetectedDataFlow } from "../core/types/data-flow";
import type { FileInfo } from "../core/types/file";
import { loadPiiSignalRules } from "../pii-signals/pii-signal-rules";
import { resolveComponentForEvidence } from "./component-evidence-resolution";
import { normalizeProjectPath } from "./import-graph";
import {
  CRYPTO_AUTH_PATTERNS,
  hasIntraComponentTransformationEvidence,
  hasStrongTransformationOnSpan,
  inferDataCategoriesFromSpan,
  inferFlowTypeFromSpan,
  isOrmModelSpan,
  PERSISTENCE_PATTERNS,
  piiRuleIdToDataCategory,
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

  for (const rule of loadPiiSignalRules()) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return true;
    }
  }

  if (PERSONAL_DATA_FIELD_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }

  return inferDataCategoriesFromSpan(span, contextSpan).length > 0;
}

function collectDataCategories(span: string, contextSpan: string): string[] {
  const categories = new Set<string>();

  for (const rule of loadPiiSignalRules()) {
    if (rule.patterns.some((pattern) => pattern.test(span))) {
      categories.add(piiRuleIdToDataCategory(rule.id));
    }
  }

  for (const category of inferDataCategoriesFromSpan(span, "")) {
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
  if (isOrmModelSpan(span) || isOrmModelSpan(contextSpan)) {
    return inferFlowTypeFromSpan(span, contextSpan);
  }
  const inferred = inferFlowTypeFromSpan(span, contextSpan);
  if (inferred === "database_query" || inferred === "api_call") {
    return inferred;
  }
  return "data_transfer";
}

function isImportOrLiteralLine(span: string): boolean {
  const trimmed = span.trim();
  if (/^import\s/.test(trimmed)) {
    return true;
  }
  if (/^["'][^"']*["'],?\s*$/.test(trimmed)) {
    return true;
  }
  return false;
}

function transformationPriority(span: string): number {
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
  if (isOrmModelSpan(span)) {
    return 1;
  }
  return 0;
}

function transformationScore(span: string): number {
  let score = transformationPriority(span) * 1000;
  if (/GenerateFromPassword|DriverValue|\.Email\s*\(/i.test(span)) {
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
): string {
  return `${componentId}\t${type}\t${normalizeProjectPath(filePath)}`;
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
      if (!hasStrongTransformationOnSpan(span)) {
        continue;
      }
      if (!hasPersonalDataReference(span, contextSpan)) {
        continue;
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

      const key = dedupeKey(component.id, flowType, file.path);
      const categories = collectDataCategories(span, contextSpan);
      const score = transformationScore(span);
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
