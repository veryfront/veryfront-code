import { fetchJsonObject, isPlainObject } from "./oidc-metadata.ts";

const MAX_JWKS_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_SECONDS = 600;
const MAX_CACHE_TTL_SECONDS = 2_592_000;
const DEFAULT_CACHE_ENTRIES = 64;
const MAX_CACHE_ENTRIES = 64;
const MAX_KEYS = 100;
const MAX_KID_LENGTH = 256;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const RSA_ALGORITHMS = new Set(["RS256", "RS384", "RS512", "PS256", "PS384", "PS512"]);
const EC_ALGORITHMS_BY_CURVE = new Map([
  ["P-256", new Set(["ES256"])],
  ["P-384", new Set(["ES384"])],
  ["P-521", new Set(["ES512"])],
]);

export type PublicJwk = Readonly<{
  readonly kty: "RSA" | "EC";
  readonly kid: string;
  readonly use?: "sig";
  readonly alg?: string;
  readonly n?: string;
  readonly e?: string;
  readonly crv?: string;
  readonly x?: string;
  readonly y?: string;
  readonly key_ops?: readonly ["verify"];
}>;

export interface JwksCacheOptions {
  readonly ttlSeconds?: number;
  readonly maxEntries?: number;
  readonly now?: () => number;
}

export interface GetJwksKeyOptions {
  readonly jwksUri: string;
  readonly kid: string;
  readonly alg: string;
  readonly forceRefresh?: boolean;
  readonly timeoutMs?: number;
}

export interface JwksCache {
  getKey(options: GetJwksKeyOptions): Promise<PublicJwk>;
}

interface JwksDocument {
  readonly keys: ReadonlyMap<string, PublicJwk>;
}

interface CacheEntry {
  readonly expiresAt: number;
  readonly value?: JwksDocument;
  readonly pending?: Promise<JwksDocument>;
}

export function createJwksCache(options: JwksCacheOptions = {}): JwksCache {
  const ttlMs = parseCacheTtlMs(options.ttlSeconds);
  const maxEntries = parseMaxEntries(options.maxEntries);
  const now = options.now ?? (() => performance.now());
  const entries = new Map<string, CacheEntry>();

  async function load(
    jwksUri: string,
    timeoutMs: number,
    forceRefresh: boolean,
  ): Promise<JwksDocument> {
    const currentTime = now();
    const current = entries.get(jwksUri);
    if (!forceRefresh && current?.value !== undefined && current.expiresAt > currentTime) {
      entries.delete(jwksUri);
      entries.set(jwksUri, current);
      return current.value;
    }
    if (!forceRefresh && current?.pending !== undefined) {
      return await current.pending;
    }

    const pending = fetchJwks(jwksUri, timeoutMs).then((value) => {
      entries.set(jwksUri, { value, expiresAt: now() + ttlMs });
      evictIfNeeded(entries, maxEntries);
      return value;
    }).catch((error) => {
      if (entries.get(jwksUri)?.pending === pending) {
        entries.delete(jwksUri);
      }
      throw error;
    });
    entries.set(jwksUri, { pending, expiresAt: currentTime + ttlMs });
    evictIfNeeded(entries, maxEntries);
    return await pending;
  }

  return Object.freeze({
    async getKey(keyOptions: GetJwksKeyOptions): Promise<PublicJwk> {
      const kid = parseKid(keyOptions.kid);
      const alg = parseAlgorithm(keyOptions.alg);
      const jwksUri = parseJwksUri(keyOptions.jwksUri).href;
      const timeoutMs = keyOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const firstDocument = await load(jwksUri, timeoutMs, keyOptions.forceRefresh === true);
      const firstKey = firstDocument.keys.get(kid);
      if (firstKey !== undefined) {
        return compatibleKey(firstKey, alg);
      }
      const refreshed = await load(jwksUri, timeoutMs, true);
      const refreshedKey = refreshed.keys.get(kid);
      if (refreshedKey === undefined) {
        throw new TypeError("JWKS does not contain the requested kid");
      }
      return compatibleKey(refreshedKey, alg);
    },
  });
}

async function fetchJwks(jwksUri: string, timeoutMs: number): Promise<JwksDocument> {
  const url = parseJwksUri(jwksUri);
  const parsed = await fetchJsonObject({
    url,
    maxBytes: MAX_JWKS_BYTES,
    timeoutMs,
    kind: "JWKS",
    authorizeUrl(candidate) {
      validateJwksUrl(candidate);
    },
  });
  return parseJwksDocument(parsed);
}

function parseJwksDocument(value: { readonly [key: string]: unknown }): JwksDocument {
  const topLevelKeys = Object.keys(value);
  if (topLevelKeys.length !== 1 || topLevelKeys[0] !== "keys") {
    throw new TypeError("JWKS must contain only the top-level keys field");
  }
  const keys = value.keys;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > MAX_KEYS) {
    throw new TypeError("JWKS keys must contain 1 through 100 keys");
  }
  const output = new Map<string, PublicJwk>();
  for (const key of keys) {
    const parsed = parsePublicJwk(key);
    if (output.has(parsed.kid)) {
      throw new TypeError("JWKS keys must not contain duplicate kid values");
    }
    output.set(parsed.kid, parsed);
  }
  return Object.freeze({ keys: output });
}

function parsePublicJwk(value: unknown): PublicJwk {
  if (!isPlainObject(value)) {
    throw new TypeError("JWKS key must be a plain object");
  }
  const kid = parseKid(value.kid);
  const use = value.use;
  if (use !== undefined && use !== "sig") {
    throw new TypeError("JWKS key use must be absent or sig");
  }
  const keyOps = parseKeyOps(value.key_ops);
  const alg = value.alg === undefined ? undefined : parseAlgorithm(value.alg);
  const kty = value.kty;
  if (kty !== "RSA" && kty !== "EC") {
    throw new TypeError("JWKS key must be an RSA or EC public signing key");
  }
  rejectPrivateOrSymmetricMaterial(value);
  if (kty === "RSA") {
    const key = parseRsaKey(value, kid, use, alg, keyOps);
    if (alg !== undefined && !RSA_ALGORITHMS.has(alg)) {
      throw new TypeError("JWKS key algorithm must be compatible with its key type");
    }
    return key;
  }
  return parseEcKey(value, kid, use, alg, keyOps);
}

function parseRsaKey(
  value: { readonly [key: string]: unknown },
  kid: string,
  use: unknown,
  alg: string | undefined,
  keyOps: readonly ["verify"] | undefined,
): PublicJwk {
  const n = parseBase64UrlMember(value.n, "n");
  const e = parseBase64UrlMember(value.e, "e");
  return freezeKey({
    kty: "RSA",
    kid,
    ...(use === "sig" ? { use: "sig" as const } : {}),
    ...(alg === undefined ? {} : { alg }),
    n,
    e,
    ...(keyOps === undefined ? {} : { key_ops: keyOps }),
  });
}

function parseEcKey(
  value: { readonly [key: string]: unknown },
  kid: string,
  use: unknown,
  alg: string | undefined,
  keyOps: readonly ["verify"] | undefined,
): PublicJwk {
  const crv = value.crv;
  if (typeof crv !== "string" || !EC_ALGORITHMS_BY_CURVE.has(crv)) {
    throw new TypeError("JWKS EC key uses an unsupported curve");
  }
  const compatibleAlgorithms = EC_ALGORITHMS_BY_CURVE.get(crv);
  if (alg !== undefined && compatibleAlgorithms !== undefined && !compatibleAlgorithms.has(alg)) {
    throw new TypeError("JWKS key algorithm must be compatible with its key type");
  }
  return freezeKey({
    kty: "EC",
    kid,
    ...(use === "sig" ? { use: "sig" as const } : {}),
    ...(alg === undefined ? {} : { alg }),
    crv,
    x: parseBase64UrlMember(value.x, "x"),
    y: parseBase64UrlMember(value.y, "y"),
    ...(keyOps === undefined ? {} : { key_ops: keyOps }),
  });
}

function compatibleKey(key: PublicJwk, expectedAlg: string): PublicJwk {
  if (key.alg !== undefined && key.alg !== expectedAlg) {
    throw new TypeError("JWKS key algorithm must be compatible with the requested algorithm");
  }
  if (key.kty === "RSA" && RSA_ALGORITHMS.has(expectedAlg)) return key;
  if (key.kty === "EC") {
    const compatibleAlgorithms = key.crv === undefined
      ? undefined
      : EC_ALGORITHMS_BY_CURVE.get(key.crv);
    if (compatibleAlgorithms?.has(expectedAlg)) return key;
  }
  throw new TypeError("JWKS key type must be compatible with the requested algorithm");
}

function rejectPrivateOrSymmetricMaterial(value: { readonly [key: string]: unknown }): void {
  for (
    const key of [
      "d",
      "p",
      "q",
      "dp",
      "dq",
      "qi",
      "oth",
      "k",
    ]
  ) {
    if (value[key] !== undefined) {
      throw new TypeError("JWKS key must not contain private or symmetric key material");
    }
  }
}

function parseKeyOps(value: unknown): readonly ["verify"] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== "verify") {
    throw new TypeError("JWKS key must not contain private key operations");
  }
  return Object.freeze(["verify"]);
}

function parseKid(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_KID_LENGTH) {
    throw new TypeError("JWKS key kid must be a bounded non-empty string");
  }
  return value;
}

function parseAlgorithm(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 32) {
    throw new TypeError("JWKS signing algorithm must be a bounded non-empty string");
  }
  return value;
}

function parseBase64UrlMember(value: unknown, member: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192) {
    throw new TypeError(`JWKS key ${member} member is malformed`);
  }
  if (!BASE64URL_PATTERN.test(value)) {
    throw new TypeError(`JWKS key ${member} member is malformed`);
  }
  return value;
}

function parseJwksUri(value: string): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new TypeError("JWKS URI must be a bounded non-empty string");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("JWKS URI must be an absolute URL");
  }
  validateJwksUrl(url);
  return url;
}

function validateJwksUrl(url: URL): void {
  if (url.protocol !== "https:") {
    throw new TypeError("JWKS URI must use HTTPS");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new TypeError("JWKS URI must not include URL credentials");
  }
  if (url.hash.length > 0) {
    throw new TypeError("JWKS URI must not include a fragment");
  }
}

function parseCacheTtlMs(value: number | undefined): number {
  const ttl = value ?? DEFAULT_CACHE_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_CACHE_TTL_SECONDS) {
    throw new TypeError("JWKS cache TTL must be 1 through 2592000 seconds");
  }
  return ttl * 1_000;
}

function parseMaxEntries(value: number | undefined): number {
  const maxEntries = value ?? DEFAULT_CACHE_ENTRIES;
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_CACHE_ENTRIES) {
    throw new TypeError("JWKS cache entry count must be 1 through 64");
  }
  return maxEntries;
}

function evictIfNeeded(entries: Map<string, CacheEntry>, maxEntries: number): void {
  while (entries.size > maxEntries) {
    const oldest = entries.keys().next().value;
    if (typeof oldest !== "string") return;
    entries.delete(oldest);
  }
}

function freezeKey(key: PublicJwk): PublicJwk {
  const keyOps: readonly ["verify"] | undefined = key.key_ops === undefined
    ? undefined
    : Object.freeze(["verify"]);
  return Object.freeze({
    ...key,
    ...(keyOps === undefined ? {} : { key_ops: keyOps }),
  });
}
