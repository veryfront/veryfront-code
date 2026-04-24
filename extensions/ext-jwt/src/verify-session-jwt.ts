import { type JWTPayload, jwtVerify, type KeyLike } from "jose";

export interface VerifySessionOptions {
  // `secret` is required at the type level so TypeScript callers are forced
  // to provide one at compile time, rather than discovering the missing
  // value only when a runtime 500 fires on every authenticated request.
  secret: Uint8Array | KeyLike;
  cookieName?: string;
  algorithms?: string[];
  issuer?: string;
  audience?: string;
}

function parseCookies(headers: Headers): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const sep = trimmed.indexOf("=");
    if (sep <= 0) continue;
    const name = trimmed.slice(0, sep).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(trimmed.slice(sep + 1));
  }
  return cookies;
}

/**
 * Verify a JWT stored in a session cookie and return its payload.
 *
 * Uses `jose.jwtVerify` with an explicit algorithms allow-list to prevent
 * `alg: "none"` and algorithm-confusion attacks. Signature, `exp`, `iss`, and
 * `aud` are all enforced.
 *
 * Returns `null` when the configured cookie is absent (no session). Rejects
 * when a cookie is present but fails verification.
 *
 * @throws Error if `opts.secret` is not provided (should be unreachable for
 * TypeScript callers; guarded for JS interop and defensive depth).
 */
export async function verifySessionJwt(
  req: Request,
  opts: VerifySessionOptions,
): Promise<JWTPayload | null> {
  if (!opts || !opts.secret) {
    throw new Error("verifySessionJwt: secret is required");
  }
  const name = opts.cookieName ?? "session";
  const token = parseCookies(req.headers)[name];
  if (!token) return null;

  const { payload } = await jwtVerify(token, opts.secret, {
    algorithms: opts.algorithms ?? ["HS256"],
    issuer: opts.issuer,
    audience: opts.audience,
  });
  return payload;
}
