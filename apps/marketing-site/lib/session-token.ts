import { SignJWT, jwtVerify } from 'jose';

// Edge-safe (jose only) — imported directly by middleware.ts. Keep bcrypt (Node-only,
// breaks the Edge Runtime build) out of this file; see lib/password.ts for hashing.

export type AdminRole = 'owner' | 'admin' | 'editor';

export type SessionPayload = {
  id: number;
  email: string;
  role: AdminRole;
};

export const SESSION_COOKIE = 'otkliks_session';
const SESSION_DURATION = '7d';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      'AUTH_SECRET is not set — required to sign/verify admin sessions. Set it in .env.local.'
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(getSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (
      typeof payload.id === 'number' &&
      typeof payload.email === 'string' &&
      (payload.role === 'owner' || payload.role === 'admin' || payload.role === 'editor')
    ) {
      return { id: payload.id, email: payload.email, role: payload.role };
    }
    return null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS,
};

export const ROLE_RANK: Record<AdminRole, number> = { editor: 0, admin: 1, owner: 2 };

export function hasAtLeastRole(role: AdminRole, required: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
