/** Canonical privacy data-action verbs (PRD §4.1). Hard cap: 11 verbs. */
export type DataAction =
  | "collect"
  | "generate"
  | "store"
  | "transform"
  | "use"
  | "combine"
  | "disclose"
  | "relay"
  | "display"
  | "log"
  | "delete";

export const DATA_ACTIONS: readonly DataAction[] = [
  "collect",
  "combine",
  "delete",
  "disclose",
  "display",
  "generate",
  "log",
  "relay",
  "store",
  "transform",
  "use",
] as const;

export const DATA_ACTION_SET: ReadonlySet<DataAction> = new Set(DATA_ACTIONS);

/** Synonyms map to canonical verbs; new needs land here, not as a 12th canonical verb. */
export const DATA_ACTION_ALIASES: Record<string, DataAction> = {
  aggregate: "transform",
  anonymize: "transform",
  cache: "store",
  capture: "collect",
  derive: "generate",
  dispose: "delete",
  enrich: "combine",
  erase: "delete",
  forward: "relay",
  infer: "generate",
  ingest: "collect",
  join: "combine",
  merge: "combine",
  passthrough: "relay",
  persist: "store",
  process: "use",
  proxy: "relay",
  purge: "delete",
  record: "collect",
  retain: "store",
  score: "generate",
  send: "disclose",
  share: "disclose",
  transmit: "disclose",
};

export interface DataActionFrameworkAnchor {
  action: DataAction;
  pram?: string;
  gdprArt4_2?: string;
  notes?: string;
}

export const DATA_ACTION_FRAMEWORK_ANCHORS: readonly DataActionFrameworkAnchor[] = [
  {
    action: "collect",
    pram: "collection",
    gdprArt4_2: "collection, recording",
  },
  {
    action: "generate",
    pram: "generation",
  },
  {
    action: "store",
    pram: "retention",
    gdprArt4_2: "storage",
  },
  {
    action: "transform",
    pram: "transformation",
  },
  {
    action: "use",
    gdprArt4_2: "use, consultation",
  },
  {
    action: "combine",
    gdprArt4_2: "alignment or combination",
  },
  {
    action: "disclose",
    pram: "disclosure, transfer",
  },
  {
    action: "relay",
    notes: "Processor-vs-conduit distinction; no PRAM/GDPR row in PRD §4.1",
  },
  {
    action: "display",
    gdprArt4_2: "consultation, dissemination",
  },
  {
    action: "log",
    pram: "logging",
  },
  {
    action: "delete",
    pram: "disposal",
    gdprArt4_2: "erasure, destruction",
  },
];

/** Normalize raw input to a snake_case token (CLI alias idiom). */
export function normalizeDataActionToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** Map a raw string to a canonical verb, or null if unknown / unmapped. */
export function normalizeDataAction(raw: string): DataAction | null {
  const token = normalizeDataActionToken(raw);
  if (!token) return null;
  if (DATA_ACTION_SET.has(token as DataAction)) return token as DataAction;
  const mapped = DATA_ACTION_ALIASES[token];
  return mapped ?? null;
}

export function isDataAction(value: string): value is DataAction {
  return DATA_ACTION_SET.has(value as DataAction);
}
