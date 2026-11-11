import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession, type SessionPayload } from './session-token';

// Node-runtime only (uses next/headers) — never import this from middleware.ts,
// which runs on the Edge runtime and reads the cookie via NextRequest instead.
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}
