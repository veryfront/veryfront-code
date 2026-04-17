import { type JWTPayload, jwtVerify, type KeyLike } from "jose";
import { parseCookies } from "./helpers.ts";

export interface VerifySessionOptions {
  cookieName?: string;
  secret?: Uint8Array | KeyLike;
  algorithms?: string[];
  issuer?: string;
  audience?: string;
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
 * @throws Error if `opts.secret` is not provided.
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
