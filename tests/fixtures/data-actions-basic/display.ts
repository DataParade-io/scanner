/**
 * Intentional display spans — surface data to a subject or internal actor.
 */

type ResponseLike = {
  send: (body: string) => void;
  json: (body: unknown) => void;
};

export function renderEmailPage(email: string, res: ResponseLike): void {
  // display — HTML response surfaces subject email
  res.send(`<p>Welcome ${email}</p>`);
}

export function returnProfileJson(
  profile: { email: string; name: string },
  res: ResponseLike,
): void {
  // display — JSON API returns PII to the caller
  res.json(profile);
}

export function showSsnLast4(ssn: string, res: ResponseLike): void {
  // display — surfaces truncated SSN to an authenticated viewer
  res.send(`****${ssn.slice(-4)}`);
}
