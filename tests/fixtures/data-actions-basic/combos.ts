/**
 * Multi-verb combo spans — same logical node performs several privacy actions.
 * Gold uses one EvalCase row per verb on the shared ${type}:${name} subject.
 */
import { createHash } from "crypto";

type RequestLike = {
  body: { email?: string; card?: string; name?: string };
  headers: Record<string, string>;
};
type ResponseLike = {
  status: (code: number) => { json: (body: unknown) => void };
  json: (body: unknown) => void;
};

declare const app: {
  post: (path: string, handler: (req: RequestLike, res: ResponseLike) => void) => void;
  use: (handler: (req: RequestLike, res: ResponseLike, next: () => void) => void) => void;
};

declare const db: {
  insertUser: (row: { email: string; name: string }) => void;
  insertHashed: (row: { emailHash: string }) => void;
  upsertMerged: (row: { email: string; accountId: string; name: string }) => void;
};

declare const logger: {
  info: (msg: Record<string, unknown>) => void;
};

declare function createProxyMiddleware(options: {
  target: string;
  changeOrigin: boolean;
}): (req: RequestLike, res: ResponseLike, next: () => void) => void;

// ---------------------------------------------------------------------------
// asset:checkout-api — collect + store + disclose + log
// ---------------------------------------------------------------------------
app.post("/checkout", (req, res) => {
  // collect — capture email/card from the data subject
  const email = req.body.email ?? "";
  const card = req.body.card ?? "";
  const name = req.body.name ?? "";

  // store — persist the customer locally
  db.insertUser({ email, name });

  // disclose — send payment details to Stripe
  void fetch("https://api.stripe.com/v1/charges", {
    method: "POST",
    headers: { authorization: "Bearer sk_test" },
    body: JSON.stringify({ email, card }),
  });

  // log — write email into application logs on the same line
  logger.info({ event: "checkout", email });

  res.status(201).json({ ok: true });
});

// ---------------------------------------------------------------------------
// asset:hash-writer — transform (pseudonymized) + store
// ---------------------------------------------------------------------------
export function hashAndPersist(email: string): void {
  // transform — sha256 hash of email (pseudonymized qualifier)
  const emailHash = createHash("sha256").update(email).digest("hex");
  // store — persist only the pseudonym
  db.insertHashed({ emailHash });
}

// ---------------------------------------------------------------------------
// asset:crm-sync — combine + store
// ---------------------------------------------------------------------------
export function syncCrmProfile(
  local: { email: string; name: string },
  crm: { email: string; accountId: string },
): void {
  // combine — merge local + CRM on email
  const merged = { email: local.email, name: local.name, accountId: crm.accountId };
  // store — upsert the combined record
  db.upsertMerged(merged);
}

// ---------------------------------------------------------------------------
// asset:edge-proxy — relay + log
// ---------------------------------------------------------------------------
const edgeProxy = createProxyMiddleware({
  target: "https://upstream.internal",
  changeOrigin: true,
});

app.use((req, res, next) => {
  // log — log forwarding metadata (may include auth header material)
  logger.info({ event: "proxy_forward", authorization: req.headers.authorization });
  // relay — passthrough to upstream without local use/store of body
  edgeProxy(req, res, next);
});

// ---------------------------------------------------------------------------
// actor:end-user — DA-1: actors must not carry dataActions (negative gold)
// ---------------------------------------------------------------------------
/** Browser / data-subject actor placeholder — never assign privacy verbs (DA-1). */
export const endUserActor = { type: "actor" as const, name: "end-user", role: "data_subject" };
