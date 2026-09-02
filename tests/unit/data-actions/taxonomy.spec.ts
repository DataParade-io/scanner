import {
  DATA_ACTIONS,
  DATA_ACTION_ALIASES,
  DATA_ACTION_FRAMEWORK_ANCHORS,
  isDataAction,
  normalizeDataAction,
  normalizeDataActionToken,
  type DataAction,
} from "../../../src/data-actions/taxonomy";

const EXPECTED_CANONICAL: DataAction[] = [
  "collect",
  "generate",
  "store",
  "transform",
  "use",
  "combine",
  "disclose",
  "relay",
  "display",
  "log",
  "delete",
];

describe("DATA_ACTIONS", () => {
  it("contains exactly 11 canonical verbs in PRD order when sorted by name", () => {
    expect(DATA_ACTIONS).toHaveLength(11);
    expect([...DATA_ACTIONS].sort()).toEqual([...EXPECTED_CANONICAL].sort());
  });
});

describe("DATA_ACTION_FRAMEWORK_ANCHORS", () => {
  it("has one anchor row per canonical verb", () => {
    expect(DATA_ACTION_FRAMEWORK_ANCHORS).toHaveLength(11);
    const anchored = DATA_ACTION_FRAMEWORK_ANCHORS.map((a) => a.action).sort();
    expect(anchored).toEqual([...EXPECTED_CANONICAL].sort());
  });

  it("documents relay without forced PRAM/GDPR rows", () => {
    const relay = DATA_ACTION_FRAMEWORK_ANCHORS.find((a) => a.action === "relay");
    expect(relay).toBeDefined();
    expect(relay!.pram).toBeUndefined();
    expect(relay!.gdprArt4_2).toBeUndefined();
    expect(relay!.notes).toMatch(/conduit/i);
  });
});

describe("DATA_ACTION_ALIASES", () => {
  const prdAliasCases: Array<[string, DataAction]> = [
    ["process", "use"],
    ["share", "disclose"],
    ["send", "disclose"],
    ["transmit", "disclose"],
    ["cache", "store"],
    ["persist", "store"],
    ["retain", "store"],
    ["forward", "relay"],
    ["proxy", "relay"],
    ["passthrough", "relay"],
    ["derive", "generate"],
    ["infer", "generate"],
    ["score", "generate"],
    ["record", "collect"],
    ["capture", "collect"],
    ["ingest", "collect"],
    ["anonymize", "transform"],
    ["aggregate", "transform"],
    ["merge", "combine"],
    ["join", "combine"],
    ["enrich", "combine"],
    ["erase", "delete"],
    ["purge", "delete"],
    ["dispose", "delete"],
  ];

  it.each(prdAliasCases)("maps %s → %s", (alias, canonical) => {
    expect(DATA_ACTION_ALIASES[alias]).toBe(canonical);
    expect(normalizeDataAction(alias)).toBe(canonical);
  });
});

describe("normalizeDataAction", () => {
  it("accepts canonical verbs with case and spacing variants", () => {
    expect(normalizeDataAction("Store")).toBe("store");
    expect(normalizeDataAction("  DISCLOSE  ")).toBe("disclose");
    expect(normalizeDataAction("log")).toBe("log");
  });

  it("normalizes alias tokens with hyphens and spaces", () => {
    expect(normalizeDataAction("Share")).toBe("disclose");
    expect(normalizeDataAction("passthrough")).toBe("relay");
    expect(normalizeDataAction("Anonymize")).toBe("transform");
  });

  it("rejects unknown tokens", () => {
    expect(normalizeDataAction("foobar")).toBeNull();
    expect(normalizeDataAction("")).toBeNull();
    expect(normalizeDataAction("processing")).toBeNull();
    expect(normalizeDataAction("   ")).toBeNull();
  });
});

describe("normalizeDataActionToken", () => {
  it("lowercases and collapses separators", () => {
    expect(normalizeDataActionToken("  Foo-Bar  ")).toBe("foo_bar");
  });
});

describe("isDataAction", () => {
  it("returns true for canonical verbs only", () => {
    expect(isDataAction("store")).toBe(true);
    expect(isDataAction("relay")).toBe(true);
  });

  it("returns false for aliases and unknown tokens", () => {
    expect(isDataAction("cache")).toBe(false);
    expect(isDataAction("share")).toBe(false);
    expect(isDataAction("unknown")).toBe(false);
  });
});
