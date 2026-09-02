/**
 * Intentional use spans — consume data for logic/decisioning without persisting.
 */

export function approveOrder(balance: number, price: number): boolean {
  // use — decisioning from in-memory values, no store
  return balance >= price;
}

export function selectPlan(userTier: "free" | "pro"): string {
  // use — consultation of tier to pick a plan string
  return userTier === "pro" ? "pro_monthly" : "free_forever";
}

export function isAdult(age: number): boolean {
  // use — boolean decision from age without retention write
  return age >= 18;
}
