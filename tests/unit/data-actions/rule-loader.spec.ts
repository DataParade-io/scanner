import fs from "fs";
import os from "os";
import path from "path";

import {
  clearDataActionRulesCacheForTest,
  loadDataActionRuleCatalog,
  loadDataActionRules,
} from "../../../src/data-actions/rule-loader";

describe("data-action rule-loader", () => {
  afterEach(() => {
    clearDataActionRulesCacheForTest();
  });

  it("loads canonical catalog with enabled=true and known actions", () => {
    const catalog = loadDataActionRuleCatalog();
    expect(catalog.enabled).toBe(true);
    expect(catalog.rules.length).toBeGreaterThan(20);
    const actions = new Set(catalog.rules.map((r) => r.action));
    expect(actions.has("log")).toBe(true);
    expect(actions.has("transform")).toBe(true);
    expect(actions.has("delete")).toBe(true);
    expect(actions.has("relay")).toBe(true);

    const logRule = catalog.rules.find((r) => r.requirePiiCooccurrence);
    expect(logRule?.action).toBe("log");

    const relayRule = catalog.rules.find((r) => r.assertRelayWithCorroboration);
    expect(relayRule?.action).toBe("relay");

    const langScoped = catalog.rules.filter((r) => r.languages && r.languages.size > 0);
    expect(langScoped.length).toBeGreaterThan(10);
    const goRules = catalog.rules.filter((r) => r.languages?.has("go"));
    const tfRules = catalog.rules.filter((r) => r.languages?.has("terraform"));
    expect(goRules.length).toBeGreaterThan(0);
    expect(tfRules.length).toBeGreaterThan(0);
  });

  it("kill-switch: enabled false yields no rules from loadDataActionRules", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "da-rules-"));
    const file = path.join(dir, "data-action.rules.yaml");
    fs.writeFileSync(
      file,
      [
        "enabled: false",
        "data_action_rules:",
        "  - id: da-log-test",
        "    action: log",
        "    require_pii_cooccurrence: true",
        "    patterns:",
        '      - "logger\\\\.info"',
      ].join("\n"),
      "utf8",
    );

    const catalog = loadDataActionRuleCatalog(file);
    expect(catalog.enabled).toBe(false);
    expect(catalog.rules).toHaveLength(1);
    expect(loadDataActionRules(file)).toEqual([]);
  });

  it("rejects unknown actions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "da-rules-bad-"));
    const file = path.join(dir, "bad.yaml");
    fs.writeFileSync(
      file,
      [
        "enabled: true",
        "data_action_rules:",
        "  - id: bad",
        "    action: shred",
        "    patterns:",
        '      - "x"',
      ].join("\n"),
      "utf8",
    );
    expect(() => loadDataActionRuleCatalog(file)).toThrow(/unknown action/i);
  });
});
