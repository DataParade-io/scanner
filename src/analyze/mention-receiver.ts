import type { AnalyzedFile } from "./engine/analyzed-file";

/**
 * The class of the receiver a concept mention on this line is reached through
 * (KDATAP-c8a46a): a member read off a typed receiver (`usersService.email`), a concept
 * key or value passed to a method of one (`usersService.createOne({ email })`,
 * `this.users.getUserByEmail(email)`, `User.objects.filter(email=...)`). Undefined when
 * no such receiver has a known class.
 */
export function mentionReceiverClass(
  file: AnalyzedFile,
  line: number,
  isConceptToken: (token: string) => boolean,
): string | undefined {
  const sites = file.sitesOnLine(line).filter((site) => isConceptToken(site.name));
  for (const site of sites) {
    if (site.role !== "member") continue;
    const found = file.classOfSiteReceiver(site);
    if (found) return found;
  }
  for (const call of file.callSitesOnLine(line)) {
    if (!call.receiver) continue;
    const carries =
      (call.keyword !== undefined && isConceptToken(call.keyword)) ||
      sites.some((site) => file.isPassedBy(site.node, call.argument));
    if (!carries) continue;
    const found = file.classOfReceiver(call.receiver);
    if (found) return found;
  }
  return undefined;
}
