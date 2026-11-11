// BFF-прокси к core-api — server-to-server (Node runtime), никаких CORS: браузер ходит
// только в marketing-site, marketing-site форвардит в core-api с токеном из своей cookie.

const CORE_API_URL = process.env.CORE_API_URL || 'http://localhost:4000';

export class CoreApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function coreApiFetch<T = unknown>(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {}
): Promise<T> {
  const res = await fetch(`${CORE_API_URL}${path}`, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CoreApiError(data.error || `core-api ${path} → ${res.status}`, res.status);
  return data as T;
}
