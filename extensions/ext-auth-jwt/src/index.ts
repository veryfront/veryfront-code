/**
 * ext-auth-jwt: AuthProvider implementation backed by `jose`.
 *
 * Provides the `AuthProvider` contract: sign / verify (HS256 by default),
 * remote-JWKS verification, public-key verification, and header decoding.
 *
 * @module extensions/ext-auth-jwt
 */

import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  importSPKI,
  type JWTPayload,
  jwtVerify,
  type KeyLike,
  SignJWT,
} from "jose";

import type { ExtensionFactory } from "veryfront/extensions";
import type {
  AuthProvider,
  SignOptions,
  TokenHeader,
  TokenPayload,
  VerifyOptions,
} from "veryfront/extensions/auth";

/**
 * Signature used by jose's verify step to resolve a key for a given header.
 *
 * Matches the shape returned by `createRemoteJWKSet` / `createLocalJWKSet`
 * and lets tests inject an in-memory key set without reaching the network.
 */
export type JwksResolver = Parameters<typeof jwtVerify>[1] & object;

/**
 * Factory for building a JWKS resolver from a URL.
 *
 * The default uses `createRemoteJWKSet`; tests can inject a stub that returns
 * a local resolver bound to an in-memory key set.
 */
export type JwksResolverFactory = (jwksUrl: string) => JwksResolver;

/**
 * Optional configuration for the ext-auth-jwt factory.
 *
 * - `secret`: HMAC secret for `sign`/`verify`. Falls back to the `JWT_SECRET`
 *   environment variable. Without one, `sign`/`verify` throw.
 * - `jwksResolverFactory`: test seam that overrides JWKS resolution.
 */
export interface ExtJwtConfig {
  secret?: string | Uint8Array;
  jwksResolverFactory?: JwksResolverFactory;
}

function defaultJwksResolverFactory(jwksUrl: string): JwksResolver {
  return createRemoteJWKSet(new URL(jwksUrl)) as unknown as JwksResolver;
}

function toUint8Array(secret: string | Uint8Array): Uint8Array {
  return typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
}

function getSecret(configSecret?: string | Uint8Array): Uint8Array {
  if (configSecret !== undefined) return toUint8Array(configSecret);
  const env = typeof Deno !== "undefined" ? Deno.env.get("JWT_SECRET") : undefined;
  if (!env) {
    throw new Error(
      "ext-auth-jwt: no HMAC secret configured. Pass `secret` to the extension " +
        "factory or set the JWT_SECRET environment variable.",
    );
  }
  return new TextEncoder().encode(env);
}

function createAuthProvider(config: ExtJwtConfig): AuthProvider {
  const jwksResolverFactory = config.jwksResolverFactory ??
    defaultJwksResolverFactory;

  // Cache one resolver per JWKS URL; `createRemoteJWKSet` maintains its own
  // internal key cache with cooldown/rotation semantics, so reusing the
  // same resolver is required for the cache to be effective.
  const jwksResolvers = new Map<string, JwksResolver>();
  const publicKeys = new Map<string, Promise<KeyLike>>();

  function getJwksResolver(jwksUrl: string): JwksResolver {
    const existing = jwksResolvers.get(jwksUrl);
    if (existing) return existing;
    const created = jwksResolverFactory(jwksUrl);
    jwksResolvers.set(jwksUrl, created);
    return created;
  }

  function getPublicKey(publicKeyPem: string, algorithm: string): Promise<KeyLike> {
    const cacheKey = `${algorithm}:${publicKeyPem}`;
    const existing = publicKeys.get(cacheKey);
    if (existing) return existing;

    const created = importSPKI(publicKeyPem, algorithm);
    publicKeys.set(cacheKey, created);
    return created;
  }

  return {
    async sign(payload: TokenPayload, options?: SignOptions): Promise<string> {
      const secret = getSecret(config.secret);
      const algorithm = options?.algorithm ?? "HS256";
      const { sub, ...rest } = payload;
      const builder = new SignJWT(rest as JWTPayload)
        .setProtectedHeader({ alg: algorithm })
        .setSubject(sub);
      if (options?.expiresIn !== undefined) {
        // jose's setExpirationTime accepts `string | number | Date`.
        builder.setExpirationTime(
          options.expiresIn as string | number,
        );
      }
      return await builder.sign(secret);
    },

    async verify(
      token: string,
      options?: VerifyOptions,
    ): Promise<TokenPayload> {
      const secret = getSecret(config.secret);
      const algorithms = options?.algorithms ?? ["HS256"];
      const { payload } = await jwtVerify(token, secret, { algorithms });
      return payload as TokenPayload;
    },

    async verifyWithJwks(
      token: string,
      jwksUrl: string,
      options?: VerifyOptions,
    ): Promise<TokenPayload> {
      const resolver = getJwksResolver(jwksUrl);
      const { algorithms, ...rest } = options ?? {};
      const verifyOpts: Record<string, unknown> = { ...rest };
      if (algorithms) verifyOpts.algorithms = algorithms;
      const { payload } = await jwtVerify(
        token,
        resolver as unknown as KeyLike,
        verifyOpts,
      );
      return payload as TokenPayload;
    },

    async verifyWithPublicKey(
      token: string,
      publicKeyPem: string,
      options?: VerifyOptions,
    ): Promise<TokenPayload> {
      const algorithms = options?.algorithms ?? ["RS256"];
      const algorithm = algorithms[0] ?? "RS256";
      const publicKey = await getPublicKey(publicKeyPem, algorithm);
      const { algorithms: _algorithms, ...rest } = options ?? {};
      const { payload } = await jwtVerify(token, publicKey, {
        ...rest,
        algorithms,
      });
      return payload as TokenPayload;
    },

    decode(token: string): TokenHeader | undefined {
      try {
        return decodeProtectedHeader(token) as TokenHeader;
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Default export — the ext-auth-jwt extension factory.
 *
 * Produces an extension that registers an `AuthProvider` contract
 * implementation backed by `jose`.
 */
const extJwt: ExtensionFactory = (config?: unknown) => {
  const cfg = (config ?? {}) as ExtJwtConfig;
  const provider = createAuthProvider(cfg);

  return {
    name: "ext-auth-jwt",
    version: "0.1.0",
    capabilities: [
      { type: "net:outbound", hosts: ["*"] },
    ],
    provides: {
      AuthProvider: provider,
    },
  };
};

export default extJwt;
export { createAuthProvider };
