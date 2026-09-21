import type { ApiError } from '@phone-erp/shared-types';

const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

/** A failed API call, carrying the server's stable error code. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /**
   * The server could not be reached. Either the browser could not connect at
   * all, or a proxy in front of the API answered for it — nginx returns 502 or
   * 504 when the Node process is down, so those mean the same thing to a user
   * as no connection at all.
   */
  get isUnreachable(): boolean {
    return (
      this.code === 'NETWORK_ERROR' ||
      this.code === 'SERVER_UNREACHABLE' ||
      [502, 503, 504].includes(this.status)
    );
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  // FormData goes through as it is. Setting Content-Type by hand would omit
  // the multipart boundary the browser generates, and the upload would arrive
  // as an unparseable blob.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

  const headers: Record<string, string> = {};
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

  // The session lives in an HTTP-only cookie; this header proves the request
  // came from our own page rather than a third-party site.
  if (method !== 'GET') {
    const csrf = readCookie('perp_csrf');
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      // Never let the HTTP cache answer for the API. A refetch exists because
      // something changed, so a reply from the browser's cache — or a `304`
      // from anything between here and the server — defeats the point of
      // asking. The server says `no-store` too; this is the half that does not
      // depend on every cache in the path honouring it.
      cache: 'no-store',
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'No connection to the server. Check your network.');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    // A proxy standing in for a dead API answers with its own body — nginx HTML,
    // or a bare "fetch failed". None of that means anything to a warehouse user,
    // so the message is ours, not the proxy's.
    if ([502, 503, 504].includes(response.status)) {
      throw new ApiRequestError(
        response.status,
        'SERVER_UNREACHABLE',
        'The server is not responding. Check your connection, or try again shortly.',
      );
    }

    const error = (payload ?? {}) as Partial<ApiError>;
    throw new ApiRequestError(
      response.status,
      error.code ?? 'UNKNOWN',
      error.message ?? `Request failed (${response.status}).`,
      error.details ?? {},
    );
  }
  return payload as T;
}

export function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const q = search.toString();
  return q ? `?${q}` : '';
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
  /** Multipart POST, for file uploads. */
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};
