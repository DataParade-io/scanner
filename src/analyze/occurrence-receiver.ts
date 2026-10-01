import type { AnalyzedFile, ReceiverInfo } from "./engine/analyzed-file";

/** How a occurrence reaches its receiver. */
export type ReceiverVia = "direct" | "payload";

export interface OccurrenceReceiver extends ReceiverInfo {
  via?: ReceiverVia;
}

/**
 * The receiver a concept occurrence on this line is reached through (KDATAP-c8a46a): a
 * member read off a typed receiver (`usersService.email`), a concept key or value passed
 * to a method of one (`usersService.createOne({ email })`,
 * `this.users.getUserByEmail(email)`, `User.objects.filter(email=...)`), or a concept key
 * in a payload object later passed to one. `className` is set when the receiver's class
 * is known; `names` are the binding names of receivers whose class is not, which the
 * caller may match against the repository's classes.
 */
export function occurrenceReceiver(
  file: AnalyzedFile,
  line: number,
  isConceptToken: (token: string) => boolean,
  sourceLine?: string,
): OccurrenceReceiver {
  const names: string[] = [];
  const sites = file.sitesOnLine(line).filter((site) => isConceptToken(site.name));
  for (const site of sites) {
    if (site.role !== "member") continue;
    const found = file.classOfSiteReceiver(site);
    if (found) return { className: found, names, via: "direct" };
    const name = file.receiverBindingName(site.object);
    if (name) names.push(name);
  }
  for (const call of file.callSitesOnLine(line)) {
    if (!call.receiver) continue;
    const carries =
      (call.keyword !== undefined && isConceptToken(call.keyword)) ||
      sites.some((site) => file.isPassedBy(site.node, call.argument));
    if (!carries) continue;
    const found = file.classOfReceiver(call.receiver);
    if (found) return { className: found, names, via: "direct" };
    const name = file.receiverBindingName(call.receiver);
    if (name) names.push(name);
  }
  // A quoted field selector inside a call's arguments (`fields: ['id', 'email']`,
  // `.select('email', ...)`) belongs to that call's receiver.
  for (const match of (sourceLine ?? "").matchAll(/(['"`])([A-Za-z_][\w.]*)\1/g)) {
    const token = match[2].split(".").pop() ?? "";
    if (!isConceptToken(token)) continue;
    const found = file.enclosingCallReceiver(line, (match.index ?? 0) + 1);
    if (found?.className) return { className: found.className, names, via: "direct" };
    if (found?.name) names.push(found.name);
  }
  const payload = file.payloadReceivers(line, isConceptToken);
  if (payload.className) return { ...payload, via: "payload" };
  const all = [...names, ...payload.names];
  if (all.length === 0) return { names };
  return { names: all, via: names.length > 0 ? "direct" : "payload" };
}

/** The class of the receiver a concept occurrence on this line is reached through. */
export function occurrenceReceiverClass(
  file: AnalyzedFile,
  line: number,
  isConceptToken: (token: string) => boolean,
): string | undefined {
  return occurrenceReceiver(file, line, isConceptToken).className;
}
