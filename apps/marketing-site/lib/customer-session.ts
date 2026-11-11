import { jwtVerify } from 'jose';

// Edge-safe (jose only, no next/headers) — сессия КЛИЕНТА продукта (личный кабинет /app),
// отдельно от admin-сессии (lib/session-token.ts — тот сайт-персонал, это покупатели).
//
// Cookie хранит НАПРЯМУЮ токен core-api (не обёрнутый в ещё один JWT) — core-api и
// marketing-site используют один AUTH_SECRET специально для этого, так marketing-site
// (BFF) может и верифицировать токен сам, и форвардить его как Bearer в core-api без
// повторного логина. Раньше был двойной JWT (обёртка вокруг обёртки) — из-за него
// cookie раздувалась вдвое и ловился трудновоспроизводимый баг с Server Actions на
// вложенных роутах (см. историю правок) — заодно и архитектурно чище.

export const CUSTOMER_SESSION_COOKIE = 'otkliks_customer_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type CustomerSessionPayload = {
  tenantId: string;
  email: string;
  // Не у всех токенов есть: поле добавлено позже, у сессий, выданных до этого,
  // его в JWT просто нет — до следующего входа. Поэтому необязательное.
  fullName?: string;
};

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is not set — required to verify customer sessions.');
  }
  return new TextEncoder().encode(secret);
}

export async function verifyCustomerSession(token: string): Promise<CustomerSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.tenantId === 'string' && typeof payload.email === 'string') {
      return {
        tenantId: payload.tenantId,
        email: payload.email,
        fullName: typeof payload.fullName === 'string' ? payload.fullName : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export const customerSessionCookieOptions = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS,
};
