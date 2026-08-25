import { fetchJsonObject, isPlainObject } from "./oidc-metadata.ts";

const MAX_JWKS_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_SECONDS = 600;
const MAX_CACHE_TTL_SECONDS = 2_592_000;
const DEFAULT_CACHE_ENTRIES = 64;
const MAX_CACHE_ENTRIES = 64;
const MAX_KEYS = 100;
const MAX_KID_LENGTH = 256;
const MIN_RSA_MODULUS_BYTES = 256;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const RSA_PUBLIC_EXPONENT = "AQAB";
const RSA_ALGORITHMS = new Set(["RS256", "RS384", "RS512", "PS256", "PS384", "PS512"]);
const EC_ALGORITHMS_BY_CURVE = new Map([
  ["P-256", new Set(["ES256"])],
  ["P-384", new Set(["ES384"])],
  ["P-521", new Set(["ES512"])],
]);
const EC_COORDINATE_BYTES_BY_CURVE = new Map([
  ["P-256", 32],
  ["P-384", 48],
  ["P-521", 66],
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
  readonly allowInsecureLoopback?: boolean;
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
    fetchOptions: { readonly jwksUri: string; readonly allowInsecureLoopback: boolean },
    timeoutMs: number,
    forceRefresh: boolean,
  ): Promise<JwksDocument> {
    const cacheKey = jwksCacheKey(fetchOptions);
    const currentTime = now();
    const current = entries.get(cacheKey);
    if (!forceRefresh && current?.value !== undefined && current.expiresAt > currentTime) {
      entries.delete(cacheKey);
      entries.set(cacheKey, current);
      return current.value;
    }
    if (!forceRefresh && current?.pending !== undefined) {
      return await current.pending;
    }

    const pending = fetchJwks(fetchOptions, timeoutMs).then((value) => {
      entries.set(cacheKey, { value, expiresAt: now() + ttlMs });
      evictIfNeeded(entries, maxEntries);
      return value;
    }).catch((error) => {
      if (entries.get(cacheKey)?.pending === pending) {
        entries.delete(cacheKey);
      }
      throw error;
    });
    entries.set(cacheKey, { pending, expiresAt: currentTime + ttlMs });
    evictIfNeeded(entries, maxEntries);
    return await pending;
  }

  return Object.freeze({
    async getKey(keyOptions: GetJwksKeyOptions): Promise<PublicJwk> {
      const kid = parseKid(keyOptions.kid);
      const alg = parseAlgorithm(keyOptions.alg);
      const allowInsecureLoopback = keyOptions.allowInsecureLoopback === true;
      const jwksUri = parseJwksUri(keyOptions.jwksUri, allowInsecureLoopback).href;
      const fetchOptions = { jwksUri, allowInsecureLoopback };
      const timeoutMs = keyOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const firstDocument = await load(fetchOptions, timeoutMs, keyOptions.forceRefresh === true);
      const firstKey = firstDocument.keys.get(kid);
      if (firstKey !== undefined) {
        return compatibleKey(firstKey, alg);
      }
      if (keyOptions.forceRefresh === true) {
        throw new TypeError("JWKS does not contain the requested kid");
      }
      const refreshed = await load(fetchOptions, timeoutMs, true);
      const refreshedKey = refreshed.keys.get(kid);
      if (refreshedKey === undefined) {
        throw new TypeError("JWKS does not contain the requested kid");
      }
      return compatibleKey(refreshedKey, alg);
    },
  });
}

async function fetchJwks(
  options: { readonly jwksUri: string; readonly allowInsecureLoopback: boolean },
  timeoutMs: number,
): Promise<JwksDocument> {
  const url = parseJwksUri(options.jwksUri, options.allowInsecureLoopback);
  const parsed = await fetchJsonObject({
    url,
    maxBytes: MAX_JWKS_BYTES,
    timeoutMs,
    allowExactHttpLoopbackEgress: options.allowInsecureLoopback,
    kind: "JWKS",
    authorizeUrl(candidate) {
      validateJwksUrl(candidate, options.allowInsecureLoopback);
    },
  });
  return await parseJwksDocument(parsed);
}

async function parseJwksDocument(
  value: { readonly [key: string]: unknown },
): Promise<JwksDocument> {
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
    const parsed = await parsePublicJwk(key);
    if (output.has(parsed.kid)) {
      throw new TypeError("JWKS keys must not contain duplicate kid values");
    }
    output.set(parsed.kid, parsed);
  }
  return Object.freeze({ keys: output });
}

async function parsePublicJwk(value: unknown): Promise<PublicJwk> {
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
    if (alg !== undefined && !RSA_ALGORITHMS.has(alg)) {
      throw new TypeError("JWKS key algorithm must be compatible with its key type");
    }
    const key = await parseRsaKey(value, kid, use, alg, keyOps);
    return key;
  }
  return await parseEcKey(value, kid, use, alg, keyOps);
}

async function parseRsaKey(
  value: { readonly [key: string]: unknown },
  kid: string,
  use: unknown,
  alg: string | undefined,
  keyOps: readonly ["verify"] | undefined,
): Promise<PublicJwk> {
  const n = parseBase64UrlMember(value.n, "n");
  const e = parseBase64UrlMember(value.e, "e");
  const modulus = decodeBase64UrlMember(n, "n");
  if (modulus.byteLength < MIN_RSA_MODULUS_BYTES) {
    throw new TypeError("JWKS RSA key modulus must be at least 2048 bits");
  }
  if (e !== RSA_PUBLIC_EXPONENT) {
    throw new TypeError("JWKS RSA key exponent must be 65537");
  }
  const key = freezeKey({
    kty: "RSA",
    kid,
    ...(use === "sig" ? { use: "sig" as const } : {}),
    ...(alg === undefined ? {} : { alg }),
    n,
    e,
    ...(keyOps === undefined ? {} : { key_ops: keyOps }),
  });
  await importPublicJwk(key, alg ?? "RS256");
  return key;
}

async function parseEcKey(
  value: { readonly [key: string]: unknown },
  kid: string,
  use: unknown,
  alg: string | undefined,
  keyOps: readonly ["verify"] | undefined,
): Promise<PublicJwk> {
  const crv = value.crv;
  if (typeof crv !== "string" || !EC_ALGORITHMS_BY_CURVE.has(crv)) {
    throw new TypeError("JWKS EC key uses an unsupported curve");
  }
  const coordinateBytes = EC_COORDINATE_BYTES_BY_CURVE.get(crv);
  if (coordinateBytes === undefined) {
    throw new TypeError("JWKS EC key uses an unsupported curve");
  }
  const compatibleAlgorithms = EC_ALGORITHMS_BY_CURVE.get(crv);
  if (alg !== undefined && compatibleAlgorithms !== undefined && !compatibleAlgorithms.has(alg)) {
    throw new TypeError("JWKS key algorithm must be compatible with its key type");
  }
  const x = parseBase64UrlMember(value.x, "x");
  const y = parseBase64UrlMember(value.y, "y");
  if (
    decodeBase64UrlMember(x, "x").byteLength !== coordinateBytes ||
    decodeBase64UrlMember(y, "y").byteLength !== coordinateBytes
  ) {
    throw new TypeError("JWKS EC key coordinate length must match its curve");
  }
  const key = freezeKey({
    kty: "EC",
    kid,
    ...(use === "sig" ? { use: "sig" as const } : {}),
    ...(alg === undefined ? {} : { alg }),
    crv,
    x,
    y,
    ...(keyOps === undefined ? {} : { key_ops: keyOps }),
  });
  const defaultAlgorithm = compatibleAlgorithms?.values().next().value;
  await importPublicJwk(key, alg ?? defaultAlgorithm ?? "ES256");
  return key;
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

function decodeBase64UrlMember(value: string, member: string): Uint8Array {
  try {
    const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${
      "=".repeat((4 - value.length % 4) % 4)
    }`;
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch (error) {
    throw new TypeError(`JWKS key ${member} member is malformed`, { cause: error });
  }
}

async function importPublicJwk(key: PublicJwk, alg: string): Promise<void> {
  let jwk: JsonWebKey;
  if (key.kty === "RSA") {
    if (key.n === undefined || key.e === undefined) {
      throw new TypeError("JWKS RSA key material is malformed");
    }
    jwk = { kty: "RSA", n: key.n, e: key.e };
  } else {
    if (key.crv === undefined || key.x === undefined || key.y === undefined) {
      throw new TypeError("JWKS EC key material is malformed");
    }
    jwk = { kty: "EC", crv: key.crv, x: key.x, y: key.y };
  }
  try {
    await crypto.subtle.importKey(
      "jwk",
      jwk,
      importAlgorithmFor(key, alg),
      false,
      ["verify"],
    );
  } catch (error) {
    throw new TypeError("JWKS key material must be importable as a public signing key", {
      cause: error,
    });
  }
}

function importAlgorithmFor(
  key: PublicJwk,
  alg: string,
): EcKeyImportParams | RsaHashedImportParams {
  if (key.kty === "EC") {
    if (typeof key.crv !== "string") {
      throw new TypeError("JWKS EC key uses an unsupported curve");
    }
    return { name: "ECDSA", namedCurve: key.crv };
  }
  const hash = alg.endsWith("384") ? "SHA-384" : alg.endsWith("512") ? "SHA-512" : "SHA-256";
  return {
    name: alg.startsWith("PS") ? "RSA-PSS" : "RSASSA-PKCS1-v1_5",
    hash,
  };
}

function parseJwksUri(value: string, allowInsecureLoopback: boolean): URL {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new TypeError("JWKS URI must be a bounded non-empty string");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("JWKS URI must be an absolute URL");
  }
  validateJwksUrl(url, allowInsecureLoopback);
  return url;
}

function validateJwksUrl(url: URL, allowInsecureLoopback: boolean): void {
  if (url.protocol !== "https:") {
    if (
      url.protocol !== "http:" ||
      allowInsecureLoopback !== true ||
      !isExactLoopbackHostname(url.hostname)
    ) {
      if (url.protocol === "http:" && allowInsecureLoopback === true) {
        throw new TypeError("JWKS URI may use HTTP only for exact loopback hosts");
      }
      throw new TypeError("JWKS URI must use HTTPS");
    }
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new TypeError("JWKS URI must not include URL credentials");
  }
  if (url.hash.length > 0) {
    throw new TypeError("JWKS URI must not include a fragment");
  }
}

function isExactLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" ||
    hostname === "[::1]";
}

function jwksCacheKey(
  options: { readonly jwksUri: string; readonly allowInsecureLoopback: boolean },
): string {
  return `${options.allowInsecureLoopback ? "loopback-http" : "https-only"}\n${options.jwksUri}`;
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
    const oldestSettled = [...entries.entries()].find(([, entry]) => entry.pending === undefined);
    if (oldestSettled === undefined) return;
    entries.delete(oldestSettled[0]);
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
