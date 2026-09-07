/**
 * Intentional relay spans — proxy / gateway passthrough without meaningful use.
 * Gold positives are documentedGap; derivation must keep topology-only relay as candidate
 * until pattern corroboration (http-proxy / passthrough) exists.
 */

type RequestLike = { url: string; method: string; headers: Record<string, string>; body?: unknown };
type ResponseLike = { status: (code: number) => { send: (body: unknown) => void } };

declare const app: {
  use: (handler: (req: RequestLike, res: ResponseLike) => void) => void;
};

declare function createProxyMiddleware(options: {
  target: string;
  changeOrigin: boolean;
}): (req: RequestLike, res: ResponseLike) => void;

// relay — http-proxy middleware passthrough to upstream billing API
const billingProxy = createProxyMiddleware({
  target: "https://billing.internal",
  changeOrigin: true,
});
app.use((req, res) => {
  billingProxy(req, res);
});

// relay — explicit forward without local processing
export function forwardWebhook(payload: unknown, upstreamUrl: string): Promise<Response> {
  return fetch(upstreamUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// relay — gateway passthrough helper (no store/use of body)
export function passthroughGateway(req: RequestLike): { method: string; url: string } {
  return { method: req.method, url: req.url };
}
