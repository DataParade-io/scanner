/**
 * Validator CLI for agent output. Agents run it from the workspace:
 *   node .tools/validate-facts.js facts.json
 * Exit 0 = valid, 1 = invalid (issues printed), 2 = unreadable.
 */
import fs from "fs";

import { factsSchema, type Facts } from "./facts-schema";

export function validateFactsText(text: string): { ok: true; facts: Facts } | { ok: false; errors: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`not valid JSON: ${(error as Error).message}`] };
  }
  const parsed = factsSchema.safeParse(json);
  if (parsed.success) {
    return { ok: true, facts: parsed.data };
  }
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
  };
}

if (require.main === module) {
  const file = process.argv[2] ?? "facts.json";
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    console.error(`cannot read ${file}`);
    process.exit(2);
  }
  const result = validateFactsText(text);
  if (result.ok) {
    console.log(
      `OK: ${result.facts.components.length} components, ${result.facts.dataFlows.length} data flows`,
    );
  } else {
    console.error(`INVALID (${result.errors.length} issue(s)):`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
}
