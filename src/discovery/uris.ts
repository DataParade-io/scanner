/** dp:-prefixed entity URI for a scanner component or flow id. */
export function entityUri(scannerId: string): string {
  return `dp:scan/entity/${scannerId}`;
}

/** dp:-prefixed Discovery record id (deterministic per scanner subject + role). */
export function discoveryUri(scannerSubjectId: string, role: string): string {
  return `dp:discovery/scan/${scannerSubjectId}/${role}`;
}
