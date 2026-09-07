/**
 * Intentional transform spans — hash / anonymize / aggregate.
 */
import { createHash } from "crypto";

export function hashEmail(email: string): string {
  // transform — cryptographic hash of an identifier (pseudonymize-style)
  return createHash("sha256").update(email).digest("hex");
}

export function anonymizeRecord(record: { email: string; age: number }): { ageBucket: string } {
  // transform — strip direct identifiers, keep coarse age bucket
  const ageBucket = record.age < 30 ? "under_30" : "30_plus";
  return { ageBucket };
}

export function aggregatePurchases(amounts: number[]): number {
  // transform — aggregate purchase amounts into a single metric
  return amounts.reduce((sum, n) => sum + n, 0);
}
