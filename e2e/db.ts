import { neon } from '@neondatabase/serverless'

/** Sign-up never verifies emails, and the admin check requires a verified one. Tests mark their admin by hand. */
export async function markEmailVerified(email: string): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is needed for admin e2e tests')
  await neon(url)`update "user" set email_verified = true where email = ${email}`
}
