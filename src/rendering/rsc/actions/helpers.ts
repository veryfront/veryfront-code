
export function base64url(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function parseCookies(headers: Headers): Record<string, string> {
  const raw = headers.get("cookie") || "";
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const [k, ...r] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(r.join("="));
  }
  return out;
}

import { SERVER_ACTION_DEFAULT_TTL_SEC } from "@veryfront/utils/constants/cache.ts";

export function generateCsrfToken(options?: { cookieName?: string; ttlSec?: number }): {
  token: string;
  setCookie: string;
} {
  const cookieName = options?.cookieName || "vf_csrf";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64url(bytes);
  const maxAge = options?.ttlSec ?? SERVER_ACTION_DEFAULT_TTL_SEC;
  const cookie = `${cookieName}=${token}; Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly`;
  return { token, setCookie: cookie };
}

export function validateCsrf(
  req: Request,
  options?: { cookieName?: string; headerName?: string },
): boolean {
  const cookieName = options?.cookieName || "vf_csrf";
  const headerName = options?.headerName || "x-csrf-token";
  const cookies = parseCookies(req.headers);
  const cookieToken = cookies[cookieName] || "";
  const headerToken = req.headers.get(headerName) || "";
  return Boolean(cookieToken) && cookieToken === headerToken;
}

export function getSessionFromJwt(
  req: Request,
  options?: { cookieName?: string },
): Record<string, unknown> | null {
  const name = options?.cookieName || "session";
  const cookies = parseCookies(req.headers);
  const token = cookies[name];
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1] ?? "";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}
