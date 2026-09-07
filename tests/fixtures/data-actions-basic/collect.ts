/**
 * Intentional collect spans for data-action eval gold.
 * Subjects: asset:signup-api (form capture), asset:geo-client (geolocation),
 * third_party:segment (tracking SDK init).
 */

type RequestLike = { body: { email?: string; name?: string } };
type ResponseLike = { status: (code: number) => { json: (body: unknown) => void } };

declare const app: {
  post: (
    path: string,
    handler: (req: RequestLike, res: ResponseLike) => void,
  ) => void;
};

declare const navigator: {
  geolocation: {
    getCurrentPosition: (cb: (pos: { coords: { latitude: number } }) => void) => void;
  };
};

declare const analytics: {
  load: (writeKey: string) => void;
  track: (event: string, props: Record<string, unknown>) => void;
};

// collect — first capture from a data subject via signup form
app.post("/signup", (req, res) => {
  const email = req.body.email;
  const name = req.body.name;
  res.status(201).json({ ok: true, email, name });
});

// collect — geolocation API captures subject location
export function captureLocation(): void {
  navigator.geolocation.getCurrentPosition((pos) => {
    void pos.coords.latitude;
  });
}

// collect — Segment tracking SDK init (ingest/capture of subject events)
analytics.load("SEGMENT_WRITE_KEY");
analytics.track("page_view", { path: "/home" });
