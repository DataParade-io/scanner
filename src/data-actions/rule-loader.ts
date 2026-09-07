import fs from "fs";
import path from "path";
import YAML from "yaml";
import { z } from "zod";

import type { FileLanguage } from "../core/types/file";
import { DATA_ACTION_SET, type DataAction } from "./taxonomy";

/** Languages a data-action pattern rule may target (mirrors FileLanguage). */
export const DATA_ACTION_RULE_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "php",
  "java",
  "kotlin",
  "csharp",
  "go",
  "cpp",
  "rust",
  "terraform",
  "json",
  "yaml",
  "env",
  "dockerfile",
] as const satisfies readonly FileLanguage[];

export type DataActionRuleLanguage = (typeof DATA_ACTION_RULE_LANGUAGES)[number];

const dataActionRuleLanguageSchema = z.enum(
  DATA_ACTION_RULE_LANGUAGES as unknown as [DataActionRuleLanguage, ...DataActionRuleLanguage[]],
);

const dataActionRuleSchema = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  patterns: z.array(z.string().min(1)).default([]),
  /** When set, rule only runs on files whose language is in this list. Omit = all languages. */
  languages: z.array(dataActionRuleLanguageSchema).optional(),
  require_pii_cooccurrence: z.boolean().optional().default(false),
  qualifier: z.string().min(1).optional(),
  assert_relay_with_corroboration: z.boolean().optional().default(false),
});

const dataActionCatalogSchema = z.object({
  enabled: z.boolean().optional().default(true),
  data_action_rules: z.array(dataActionRuleSchema).default([]),
});

export interface DataActionPatternRule {
  id: string;
  action: DataAction;
  patterns: RegExp[];
  /** Empty/undefined = applies to every FileLanguage. */
  languages?: ReadonlySet<FileLanguage>;
  requirePiiCooccurrence: boolean;
  qualifier?: string;
  assertRelayWithCorroboration: boolean;
}

export interface DataActionRuleCatalog {
  enabled: boolean;
  rules: DataActionPatternRule[];
}

let cachedCatalog: DataActionRuleCatalog | undefined;

export function clearDataActionRulesCacheForTest(): void {
  cachedCatalog = undefined;
}

function getDataActionRulesPath(): string {
  const parts = __dirname.split(path.sep);
  const distIndex = parts.lastIndexOf("dist");
  const root =
    distIndex !== -1
      ? parts.slice(0, distIndex).join(path.sep)
      : path.resolve(__dirname, "..", "..");
  return path.join(root, "patterns", "data-action.rules.yaml");
}

function toCanonicalAction(raw: string): DataAction {
  const normalized = raw.trim().toLowerCase();
  if (!DATA_ACTION_SET.has(normalized as DataAction)) {
    throw new Error(
      `data-action rule uses unknown action '${raw}' (not in canonical set)`,
    );
  }
  return normalized as DataAction;
}

export function ruleAppliesToLanguage(
  rule: DataActionPatternRule,
  language: FileLanguage,
): boolean {
  if (!rule.languages || rule.languages.size === 0) return true;
  return rule.languages.has(language);
}

export function loadDataActionRuleCatalog(
  configPath: string = getDataActionRulesPath(),
): DataActionRuleCatalog {
  if (cachedCatalog && configPath === getDataActionRulesPath()) {
    return cachedCatalog;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Data-action rules are required but could not be read from '${configPath}': ${message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Data-action rules at '${configPath}' could not be parsed as YAML: ${message}`,
    );
  }

  let normalized: z.infer<typeof dataActionCatalogSchema>;
  try {
    normalized = dataActionCatalogSchema.parse(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Data-action rules at '${configPath}' failed schema validation: ${message}`,
    );
  }

  const catalog: DataActionRuleCatalog = {
    enabled: normalized.enabled,
    rules: normalized.data_action_rules.map((rule) => {
      const action = toCanonicalAction(rule.action);
      if (rule.assert_relay_with_corroboration && action !== "relay") {
        throw new Error(
          `data-action rule '${rule.id}': assert_relay_with_corroboration requires action relay`,
        );
      }
      return {
        id: rule.id.trim().toLowerCase(),
        action,
        patterns: rule.patterns.map((pattern) => new RegExp(pattern, "i")),
        languages:
          rule.languages && rule.languages.length > 0
            ? new Set(rule.languages)
            : undefined,
        requirePiiCooccurrence: Boolean(rule.require_pii_cooccurrence),
        qualifier: rule.qualifier?.trim() || undefined,
        assertRelayWithCorroboration: Boolean(
          rule.assert_relay_with_corroboration,
        ),
      };
    }),
  };

  if (configPath === getDataActionRulesPath()) {
    cachedCatalog = catalog;
  }
  return catalog;
}

export function loadDataActionRules(
  configPath?: string,
): DataActionPatternRule[] {
  const catalog = loadDataActionRuleCatalog(configPath);
  return catalog.enabled ? catalog.rules : [];
}
