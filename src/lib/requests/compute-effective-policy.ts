/**
 * M10.4: the pure decision at the heart of Pro entitlement enforcement for
 * Approval Policies. Deliberately generic over the configured-policy shape
 * so both call sites (the create-request submission path and the request-
 * type-changed modal rebuild, each carrying a differently-shaped policy
 * object) can reuse the exact same rule without either duplicating it or
 * forcing a shared type onto unrelated callers.
 *
 * `approval_policies.active` continues to mean only "an admin configured
 * this policy as active" — it is never redefined. Whether that configured
 * policy is currently EFFECTIVE for new request routing additionally
 * requires the workspace's `canUsePolicyRouting` capability (see
 * src/lib/billing/entitlements.ts) — the billing entitlement layer's own
 * interpretation of Paddle status, never re-derived here. A configured
 * policy that stops being effective (Free) is never mutated by this
 * check — it stays stored exactly as-is and becomes effective again
 * automatically the moment canUsePolicyRouting is true again.
 */
export function computeEffectivePolicy<T>(configuredPolicy: T | null, canUsePolicyRouting: boolean): T | null {
  if (!configuredPolicy) {
    return null;
  }
  return canUsePolicyRouting ? configuredPolicy : null;
}
