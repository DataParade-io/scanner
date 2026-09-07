/**
 * Intentional combine spans — merge / join / enrich across sources.
 */

export function mergeProfile(
  local: { email: string; name: string },
  crm: { email: string; accountId: string },
): { email: string; name: string; accountId: string } {
  // combine — merge local profile with CRM record on email
  return { email: local.email, name: local.name, accountId: crm.accountId };
}

export function joinOrdersWithUsers(
  users: Array<{ id: string; email: string }>,
  orders: Array<{ userId: string; total: number }>,
): Array<{ email: string; total: number }> {
  // combine — join users and orders on user id
  return orders.map((order) => {
    const user = users.find((u) => u.id === order.userId);
    return { email: user?.email ?? "unknown", total: order.total };
  });
}

export function enrichWithSegment(
  user: { email: string },
  traits: { plan: string },
): { email: string; plan: string } {
  // combine — enrich user record with segment traits
  return { email: user.email, plan: traits.plan };
}
