/**
 * Intentional generate spans — creates new personal data via score/infer/derive.
 */

export function scoreUser(features: { age: number; purchases: number }): number {
  // generate — risk/credit-style score derived from subject features
  return features.age * 0.1 + features.purchases * 2;
}

export function inferRisk(email: string): "low" | "high" {
  // generate — inference produces a new risk label about the subject
  return email.endsWith("@corp.com") ? "low" : "high";
}

export function deriveProfileField(firstName: string, lastName: string): string {
  // generate — derived display profile field from source PII
  return `${firstName} ${lastName}`.trim();
}
