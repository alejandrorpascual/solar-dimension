/**
 * Admin = a verified email listed in ADMIN_EMAILS. The verified check matters: sign-up does not confirm emails,
 * so anyone could otherwise register the admin's address first.
 */
export function isAdmin(user: { email: string; emailVerified: boolean } | null | undefined, adminEmailsRaw: string | undefined): boolean {
  if (!user?.emailVerified) return false
  const allowed = new Set((adminEmailsRaw ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))
  return allowed.has(user.email.trim().toLowerCase())
}
