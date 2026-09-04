import path from "path";

import type { DetectedComponent } from "../core/types/component";
import type { FileInfo } from "../core/types/file";
import type { DataActionAssignment } from "../core/types/data-action";
import { componentMayCarryDataActions } from "../core/types/data-action";
import {
  matchPiiSignalsInFile,
  type PiiSignalHit,
} from "../pii-signals/match-pii-signals";
import {
  loadDataActionRuleCatalog,
  ruleAppliesToLanguage,
  type DataActionPatternRule,
  type DataActionRuleCatalog,
} from "./rule-loader";

export interface DeriveFromPatternsOptions {
  /** Kill-switch override; when false, emit nothing regardless of YAML `enabled`. */
  enabled?: boolean;
  catalog?: DataActionRuleCatalog;
  rules?: DataActionPatternRule[];
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function pathsReferToSameFile(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (na === nb) return true;
  if (na.endsWith("/" + nb) || nb.endsWith("/" + na)) return true;
  const baseA = path.posix.basename(na);
  const baseB = path.posix.basename(nb);
  if (baseA !== baseB) return false;
  return na.endsWith(nb) || nb.endsWith(na);
}

function componentsForHit(
  components: DetectedComponent[],
  filePath: string,
  line: number,
): DetectedComponent[] {
  const eligible = components.filter((c) => componentMayCarryDataActions(c.type));
  const withFile = eligible.filter((c) =>
    c.sourceLocations.some((loc) => pathsReferToSameFile(loc.filePath, filePath)),
  );
  if (withFile.length === 0) return [];

  const covering = withFile.filter((c) =>
    c.sourceLocations.some(
      (loc) =>
        pathsReferToSameFile(loc.filePath, filePath) &&
        loc.startLine <= line &&
        loc.endLine >= line,
    ),
  );
  return covering.length > 0 ? covering : withFile;
}

function piiLinesForFile(
  filePath: string,
  content: string,
): Set<number> {
  const hits: PiiSignalHit[] = matchPiiSignalsInFile({ filePath, content });
  return new Set(hits.map((hit) => hit.evidence.startLine));
}

function pushAssignment(
  proposed: Map<string, DataActionAssignment[]>,
  componentId: string,
  assignment: DataActionAssignment,
): void {
  const list = proposed.get(componentId) ?? [];
  list.push(assignment);
  proposed.set(componentId, list);
}

/**
 * Derive privacy verbs from file pattern rules (PRD §4.3.2).
 * `log` requires PII-signal co-occurrence on the same line.
 * `relay` from patterns is asserted only when the rule sets
 * `assert_relay_with_corroboration` (corroboration = rule id).
 */
export function deriveFromPatterns(
  components: DetectedComponent[],
  files: FileInfo[],
  options: DeriveFromPatternsOptions = {},
): Map<string, DataActionAssignment[]> {
  const catalog = options.catalog ?? loadDataActionRuleCatalog();
  const enabled = options.enabled ?? catalog.enabled;
  if (!enabled) {
    return new Map();
  }

  const rules = options.rules ?? (catalog.enabled ? catalog.rules : []);
  if (rules.length === 0) {
    return new Map();
  }

  const proposed = new Map<string, DataActionAssignment[]>();

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    const piiLines = rules.some((r) => r.requirePiiCooccurrence)
      ? piiLinesForFile(file.path, file.content)
      : null;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex] ?? "";
      const lineNumber = lineIndex + 1;

      for (const rule of rules) {
        if (!ruleAppliesToLanguage(rule, file.language)) {
          continue;
        }
        if (!rule.patterns.some((pattern) => pattern.test(line))) {
          continue;
        }
        if (rule.requirePiiCooccurrence) {
          if (!piiLines || !piiLines.has(lineNumber)) {
            continue;
          }
        }

        const targets = componentsForHit(components, file.path, lineNumber);
        if (targets.length === 0) continue;

        for (const target of targets) {
          if (rule.action === "relay") {
            if (!rule.assertRelayWithCorroboration) {
              // Topology-only style: never assert absence without corroboration flag.
              pushAssignment(proposed, target.id, {
                action: "relay",
                source: "deterministic",
                confidence: 1,
                status: "candidate",
                evidence: {
                  kind: "pattern_rule",
                  description: `matched ${rule.id} without assert flag`,
                  ruleId: rule.id,
                },
              });
              continue;
            }
            pushAssignment(proposed, target.id, {
              action: "relay",
              source: "deterministic",
              confidence: 1,
              status: "asserted",
              evidence: {
                kind: "pattern_rule",
                description: `proxy/passthrough pattern ${rule.id}`,
                ruleId: rule.id,
                corroboration: rule.id,
              },
            });
            continue;
          }

          pushAssignment(proposed, target.id, {
            action: rule.action,
            qualifier: rule.qualifier,
            source: "deterministic",
            confidence: 1,
            status: "asserted",
            evidence: [
              {
                filePath: file.path,
                startLine: lineNumber,
                endLine: lineNumber,
                code: line.trim().slice(0, 200),
              },
            ],
          });
        }
      }
    }
  }

  return proposed;
}
