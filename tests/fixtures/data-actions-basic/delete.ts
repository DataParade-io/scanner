/**
 * Intentional delete spans — disposal / retention enforcement.
 */

type RequestLike = { params: { id: string } };
type ResponseLike = { status: (code: number) => { send: (body: string) => void } };

declare const app: {
  delete: (
    path: string,
    handler: (req: RequestLike, res: ResponseLike) => void,
  ) => void;
};

declare const userStore: {
  erase: (id: string) => void;
  purgeExpired: () => number;
};

// delete — HTTP DELETE endpoint removes a user record
app.delete("/users/:id", (req, res) => {
  userStore.erase(req.params.id);
  res.status(204).send("");
});

export function purgeExpiredSessions(): number {
  // delete — purge expired retention window
  return userStore.purgeExpired();
}

export const RETENTION_TTL_DAYS = 30; // delete — TTL config for disposal enforcement
