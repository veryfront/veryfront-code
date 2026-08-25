import { fetchJsonObject, isPlainObject } from "./oidc-metadata.ts";

const MAX_JWKS_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_SECONDS = 600;
const MAX_CACHE_TTL_SECONDS = 2_592_000;
const DEFAULT_CACHE_ENTRIES = 64;
const MAX_CACHE_ENTRIES = 64;
const FORCED_REFRESH_COOLDOWN_MS = 1_000;
const MAX_KEYS = 100;
const MAX_KID_LENGTH = 256;
const MIN_RSA_MODULUS_BYTES = 256;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const RSA_PUBLIC_EXPONENT = "AQAB";
const Atob = atob;
const ArrayIsArray = Array.isArray;
const NativeMap = Map;
const NativePromise = Promise;
const NativeSet = Set;
const ReflectApply = Reflect.apply;
const MapPrototypeDelete = NativeMap.prototype.delete;
const MapPrototypeForEach = NativeMap.prototype.forEach;
const MapPrototypeGet = NativeMap.prototype.get;
const MapPrototypeHas = NativeMap.prototype.has;
const MapPrototypeSet = NativeMap.prototype.set;
const MapSizeGetter = Object.getOwnPropertyDescriptor(NativeMap.prototype, "size")?.get;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectKeys = Object.keys;
const PromisePrototypeThen = NativePromise.prototype.then;
const SetPrototypeHas = NativeSet.prototype.has;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeRepeat = String.prototype.repeat;
const StringPrototypeReplaceAll = String.prototype.replaceAll;
const RSA_ALGORITHMS = new NativeSet([
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
]);
const EC_ALGORITHMS_BY_CURVE = new NativeMap([
  ["P-256", new NativeSet(["ES256"])],
  ["P-384", new NativeSet(["ES384"])],
  ["P-521", new NativeSet(["ES512"])],
]);
const EC_COORDINATE_BYTES_BY_CURVE = new NativeMap([
  ["P-256", 32],
  ["P-384", 48],
  ["P-521", 66],
]);
const ObjectFreeze = Object.freeze;
const CryptoSubtle = crypto.subtle;
const SubtleCryptoImportKey = CryptoSubtle.importKey;
const NATIVE_GET_KEY_WITH_FRESHNESS = Symbol("Veryfront.nativeJwksCacheGetKeyWithFreshness");

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
  readonly issuer?: string;
  readonly jwksUri: string;
  readonly kid?: string;
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

interface SettledCacheEntry {
  readonly kind: "settled";
  readonly expiresAt: number;
  readonly value: JwksDocument;
  readonly freshness: JwksFreshnessToken;
  readonly signatureRefreshAllowedAt: number;
  readonly unknownKidRefreshAllowedAt: number;
  readonly incompatibleKeyRefreshAllowedAt: number;
}

interface PendingCacheEntry {
  readonly kind: "pending";
  readonly expiresAt: number;
  readonly pending: Promise<JwksLoad>;
  readonly previous?: SettledCacheEntry;
}

type CacheEntry = SettledCacheEntry | PendingCacheEntry;

type RefreshKind =
  | "none"
  | "explicit"
  | "signature-mismatch"
  | "unknown-kid"
  | "incompatible-key";

class JwksFreshnessToken {}

interface JwksLoad {
  readonly document: JwksDocument;
  readonly freshness: JwksFreshnessToken;
  readonly refreshed: boolean;
}

export interface JwksKeySnapshot {
  readonly key: PublicJwk;
  readonly freshness: object;
}

type NativeJwksCache = JwksCache & {
  readonly [NATIVE_GET_KEY_WITH_FRESHNESS]: (
    options: GetJwksKeyOptions,
    refreshIfCurrent?: JwksKeySnapshot["freshness"],
  ) => Promise<JwksKeySnapshot>;
};

export async function getJwksKeyWithFreshness(
  cache: JwksCache,
  options: GetJwksKeyOptions,
  refreshIfCurrent?: JwksKeySnapshot["freshness"],
): Promise<JwksKeySnapshot> {
  const native = ObjectGetOwnPropertyDescriptor(cache, NATIVE_GET_KEY_WITH_FRESHNESS)?.value;
  if (typeof native === "function") {
    return await native(options, refreshIfCurrent);
  }
  return keySnapshot(await cache.getKey(options), new JwksFreshnessToken());
}

export function createJwksCache(options: JwksCacheOptions = {}): JwksCache {
  const ttlMs = parseCacheTtlMs(options.ttlSeconds);
  const maxEntries = parseMaxEntries(options.maxEntries);
  const now = options.now ?? (() => performance.now());
  const entries = new NativeMap<string, CacheEntry>();

  async function load(
    fetchOptions: {
      readonly issuer: string;
      readonly jwksUri: string;
      readonly allowInsecureLoopback: boolean;
    },
    timeoutMs: number,
    refreshKind: RefreshKind,
    requestedKid: string | undefined,
    refreshIfCurrent?: JwksKeySnapshot["freshness"],
  ): Promise<JwksLoad> {
    const forceRefresh = refreshKind !== "none";
    const cacheKey = jwksCacheKey(fetchOptions, timeoutMs);
    const currentTime = now();
    const current = mapGet(entries, cacheKey);
    if (!forceRefresh && current?.kind === "settled" && current.expiresAt > currentTime) {
      mapDelete(entries, cacheKey);
      mapSet(entries, cacheKey, current);
      return {
        document: current.value,
        freshness: current.freshness,
        refreshed: false,
      };
    }
    if (current?.kind === "pending") {
      if (
        !forceRefresh && current.previous !== undefined &&
        current.previous.expiresAt > currentTime
      ) {
        return {
          document: current.previous.value,
          freshness: current.previous.freshness,
          refreshed: false,
        };
      }
      return await current.pending;
    }
    if (forceRefresh && refreshIfCurrent !== undefined && current?.freshness !== refreshIfCurrent) {
      if (current?.kind === "settled" && current.expiresAt > currentTime) {
        mapDelete(entries, cacheKey);
        mapSet(entries, cacheKey, current);
        return {
          document: current.value,
          freshness: current.freshness,
          refreshed: false,
        };
      }
    }
    if (
      forceRefresh && refreshIfCurrent !== undefined && current?.kind === "settled" &&
      current.expiresAt > currentTime &&
      refreshAllowedAt(current, refreshKind) > currentTime
    ) {
      mapDelete(entries, cacheKey);
      mapSet(entries, cacheKey, current);
      return {
        document: current.value,
        freshness: current.freshness,
        refreshed: false,
      };
    }

    reserveLoadCapacity(entries, cacheKey, maxEntries);
    const previous = current?.kind === "settled"
      ? withRefreshCooldown(current, refreshKind, currentTime)
      : undefined;
    const pending = promiseThen(
      fetchJwks(fetchOptions, timeoutMs, requestedKid),
      (value) => {
        const freshness = new JwksFreshnessToken();
        const completedAt = now();
        const unchangedForcedRefresh = forceRefresh && current?.kind === "settled" &&
          sameJwksDocument(current.value, value);
        const refreshBudget = unchangedForcedRefresh
          ? refreshCooldown(current, refreshKind, completedAt)
          : emptyRefreshBudget();
        mapSet(entries, cacheKey, {
          kind: "settled",
          value,
          freshness,
          expiresAt: completedAt + ttlMs,
          ...refreshBudget,
        });
        evictIfNeeded(entries, maxEntries);
        return { document: value, freshness, refreshed: forceRefresh };
      },
      (error) => {
        const failed = mapGet(entries, cacheKey);
        if (failed?.kind === "pending" && failed.pending === pending) {
          if (failed.previous !== undefined && failed.previous.expiresAt > now()) {
            mapSet(entries, cacheKey, failed.previous);
          } else {
            mapDelete(entries, cacheKey);
          }
        }
        throw error;
      },
    );
    mapSet(entries, cacheKey, {
      kind: "pending",
      pending,
      previous,
      expiresAt: currentTime + ttlMs,
    });
    evictIfNeeded(entries, maxEntries);
    return await pending;
  }

  async function getKeyWithFreshness(
    keyOptions: GetJwksKeyOptions,
    refreshIfCurrent?: JwksKeySnapshot["freshness"],
  ): Promise<JwksKeySnapshot> {
    const kid = keyOptions.kid === undefined ? undefined : parseKid(keyOptions.kid);
    const alg = parseAlgorithm(keyOptions.alg);
    const allowInsecureLoopback = keyOptions.allowInsecureLoopback === true;
    const jwksUri = parseJwksUri(keyOptions.jwksUri, allowInsecureLoopback).href;
    const issuer = keyOptions.issuer === undefined ? jwksUri : parseCacheIssuer(keyOptions.issuer);
    const fetchOptions = { issuer, jwksUri, allowInsecureLoopback };
    const timeoutMs = keyOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const firstLoad = await load(
      fetchOptions,
      timeoutMs,
      keyOptions.forceRefresh === true
        ? refreshIfCurrent === undefined ? "explicit" : "signature-mismatch"
        : "none",
      kid,
      refreshIfCurrent,
    );
    if (kid === undefined) {
      return keySnapshot(selectOnlyCompatibleKey(firstLoad.document, alg), firstLoad.freshness);
    }
    const firstKey = mapGet(firstLoad.document.keys, kid);
    if (firstKey !== undefined) {
      const compatible = compatibleKeyOrUndefined(firstKey, alg);
      if (compatible !== undefined) {
        return keySnapshot(compatible, firstLoad.freshness);
      }
      if (keyOptions.forceRefresh === true || firstLoad.refreshed) {
        return keySnapshot(compatibleKey(firstKey, alg), firstLoad.freshness);
      }
      const refreshed = await load(
        fetchOptions,
        timeoutMs,
        "incompatible-key",
        kid,
        firstLoad.freshness,
      );
      const refreshedKey = mapGet(refreshed.document.keys, kid);
      if (refreshedKey === undefined) {
        throw new TypeError("JWKS does not contain the requested kid");
      }
      return keySnapshot(compatibleKey(refreshedKey, alg), refreshed.freshness);
    }
    if (keyOptions.forceRefresh === true || firstLoad.refreshed) {
      throw new TypeError("JWKS does not contain the requested kid");
    }
    const refreshed = await load(
      fetchOptions,
      timeoutMs,
      "unknown-kid",
      kid,
      firstLoad.freshness,
    );
    const refreshedKey = mapGet(refreshed.document.keys, kid);
    if (refreshedKey === undefined) {
      throw new TypeError("JWKS does not contain the requested kid");
    }
    return keySnapshot(compatibleKey(refreshedKey, alg), refreshed.freshness);
  }

  const cache: NativeJwksCache = ObjectFreeze({
    async getKey(keyOptions: GetJwksKeyOptions): Promise<PublicJwk> {
      return (await getKeyWithFreshness(keyOptions)).key;
    },
    [NATIVE_GET_KEY_WITH_FRESHNESS]: getKeyWithFreshness,
  });
  return cache;
}

function keySnapshot(key: PublicJwk, freshness: JwksFreshnessToken): JwksKeySnapshot {
  return ObjectFreeze({ key, freshness });
}

function emptyRefreshBudget(): Pick<
  SettledCacheEntry,
  | "signatureRefreshAllowedAt"
  | "unknownKidRefreshAllowedAt"
  | "incompatibleKeyRefreshAllowedAt"
> {
  return {
    signatureRefreshAllowedAt: 0,
    unknownKidRefreshAllowedAt: 0,
    incompatibleKeyRefreshAllowedAt: 0,
  };
}

function refreshAllowedAt(entry: SettledCacheEntry, refreshKind: RefreshKind): number {
  if (refreshKind === "signature-mismatch") return entry.signatureRefreshAllowedAt;
  if (refreshKind === "unknown-kid") return entry.unknownKidRefreshAllowedAt;
  if (refreshKind === "incompatible-key") return entry.incompatibleKeyRefreshAllowedAt;
  return 0;
}

function withRefreshCooldown(
  entry: SettledCacheEntry,
  refreshKind: RefreshKind,
  currentTime: number,
): SettledCacheEntry {
  return {
    ...entry,
    ...refreshCooldown(entry, refreshKind, currentTime),
  };
}

function refreshCooldown(
  entry: SettledCacheEntry,
  refreshKind: RefreshKind,
  currentTime: number,
): Pick<
  SettledCacheEntry,
  | "signatureRefreshAllowedAt"
  | "unknownKidRefreshAllowedAt"
  | "incompatibleKeyRefreshAllowedAt"
> {
  return {
    signatureRefreshAllowedAt: refreshKind === "signature-mismatch"
      ? currentTime + FORCED_REFRESH_COOLDOWN_MS
      : entry.signatureRefreshAllowedAt,
    unknownKidRefreshAllowedAt: refreshKind === "unknown-kid"
      ? currentTime + FORCED_REFRESH_COOLDOWN_MS
      : entry.unknownKidRefreshAllowedAt,
    incompatibleKeyRefreshAllowedAt: refreshKind === "incompatible-key"
      ? currentTime + FORCED_REFRESH_COOLDOWN_MS
      : entry.incompatibleKeyRefreshAllowedAt,
  };
}

function sameJwksDocument(left: JwksDocument, right: JwksDocument): boolean {
  if (mapSize(left.keys) !== mapSize(right.keys)) return false;
  let same = true;
  mapForEach(left.keys, (leftKey, kid) => {
    const rightKey = mapGet(right.keys, kid);
    if (rightKey === undefined || !samePublicJwk(leftKey, rightKey)) same = false;
  });
  return same;
}

function samePublicJwk(left: PublicJwk, right: PublicJwk): boolean {
  return left.kty === right.kty && left.kid === right.kid && left.use === right.use &&
    left.alg === right.alg && left.n === right.n && left.e === right.e && left.crv === right.crv &&
    left.x === right.x && left.y === right.y &&
    (left.key_ops === undefined) === (right.key_ops === undefined);
}

async function fetchJwks(
  options: { readonly jwksUri: string; readonly allowInsecureLoopback: boolean },
  timeoutMs: number,
  requestedKid: string | undefined,
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
  return await parseJwksDocument(parsed, requestedKid);
}

async function parseJwksDocument(
  value: { readonly [key: string]: unknown },
  requestedKid: string | undefined,
): Promise<JwksDocument> {
  const topLevelKeys = ObjectKeys(value);
  if (topLevelKeys.length !== 1 || topLevelKeys[0] !== "keys") {
    throw new TypeError("JWKS must contain only the top-level keys field");
  }
  const keys = value.keys;
  if (!ArrayIsArray(keys) || keys.length < 1 || keys.length > MAX_KEYS) {
    throw new TypeError("JWKS keys must contain 1 through 100 keys");
  }
  const output = new NativeMap<string, PublicJwk>();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const selected = isPlainObject(key) && key.kid === requestedKid;
    let parsed: PublicJwk;
    try {
      parsed = await parsePublicJwk(key);
    } catch (error) {
      if (selected || !(error instanceof TypeError)) throw error;
      continue;
    }
    if (mapHas(output, parsed.kid)) {
      throw new TypeError("JWKS keys must not contain duplicate kid values");
    }
    mapSet(output, parsed.kid, parsed);
  }
  return ObjectFreeze({ keys: output });
}

function selectOnlyCompatibleKey(document: JwksDocument, alg: string): PublicJwk {
  let selected: PublicJwk | undefined;
  let count = 0;
  mapForEach(document.keys, (key) => {
    const compatible = compatibleKeyOrUndefined(key, alg);
    if (compatible === undefined) return;
    selected = compatible;
    count += 1;
  });
  if (count === 1 && selected !== undefined) return selected;
  if (count === 0) {
    throw new TypeError("JWKS does not contain a compatible signing key");
  }
  throw new TypeError("JWKS contains multiple compatible signing keys");
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
    if (alg !== undefined && !setHas(RSA_ALGORITHMS, alg)) {
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
  if (typeof crv !== "string" || !mapHas(EC_ALGORITHMS_BY_CURVE, crv)) {
    throw new TypeError("JWKS EC key uses an unsupported curve");
  }
  const coordinateBytes = mapGet(EC_COORDINATE_BYTES_BY_CURVE, crv);
  if (coordinateBytes === undefined) {
    throw new TypeError("JWKS EC key uses an unsupported curve");
  }
  const compatibleAlgorithms = mapGet(EC_ALGORITHMS_BY_CURVE, crv);
  if (
    alg !== undefined && compatibleAlgorithms !== undefined && !setHas(compatibleAlgorithms, alg)
  ) {
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
  const defaultAlgorithm = defaultEcAlgorithm(crv);
  await importPublicJwk(key, alg ?? defaultAlgorithm ?? "ES256");
  return key;
}

function compatibleKey(key: PublicJwk, expectedAlg: string): PublicJwk {
  const compatible = compatibleKeyOrUndefined(key, expectedAlg);
  if (compatible !== undefined) return compatible;
  if (key.alg !== undefined && key.alg !== expectedAlg) {
    throw new TypeError("JWKS key algorithm must be compatible with the requested algorithm");
  }
  throw new TypeError("JWKS key type must be compatible with the requested algorithm");
}

function compatibleKeyOrUndefined(
  key: PublicJwk,
  expectedAlg: string,
): PublicJwk | undefined {
  if (key.alg !== undefined && key.alg !== expectedAlg) return undefined;
  if (key.kty === "RSA" && setHas(RSA_ALGORITHMS, expectedAlg)) return key;
  if (key.kty === "EC") {
    const compatibleAlgorithms = key.crv === undefined
      ? undefined
      : mapGet(EC_ALGORITHMS_BY_CURVE, key.crv);
    if (compatibleAlgorithms !== undefined && setHas(compatibleAlgorithms, expectedAlg)) return key;
  }
  return undefined;
}

function defaultEcAlgorithm(curve: string): string | undefined {
  if (curve === "P-256") return "ES256";
  if (curve === "P-384") return "ES384";
  if (curve === "P-521") return "ES512";
  return undefined;
}

function rejectPrivateOrSymmetricMaterial(value: { readonly [key: string]: unknown }): void {
  const privateMembers = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];
  for (let index = 0; index < privateMembers.length; index += 1) {
    const key = privateMembers[index]!;
    if (value[key] !== undefined) {
      throw new TypeError("JWKS key must not contain private or symmetric key material");
    }
  }
}

function parseKeyOps(value: unknown): readonly ["verify"] | undefined {
  if (value === undefined) return undefined;
  if (!ArrayIsArray(value) || value.length !== 1 || value[0] !== "verify") {
    throw new TypeError("JWKS key must not contain private key operations");
  }
  return ObjectFreeze(["verify"]);
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

function parseCacheIssuer(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new TypeError("JWKS cache issuer must be a bounded non-empty string");
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
    const plus = ReflectApply(StringPrototypeReplaceAll, value, ["-", "+"]) as string;
    const slash = ReflectApply(StringPrototypeReplaceAll, plus, ["_", "/"]) as string;
    const suffix = ReflectApply(StringPrototypeRepeat, "=", [
      (4 - value.length % 4) % 4,
    ]) as string;
    const binary = Atob(`${slash}${suffix}`);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      output[index] = ReflectApply(StringPrototypeCharCodeAt, binary, [index]) as number;
    }
    return output;
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
    await ReflectApply(SubtleCryptoImportKey, CryptoSubtle, [
      "jwk",
      jwk,
      importAlgorithmFor(key, alg),
      false,
      ["verify"],
    ]);
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
  options: {
    readonly issuer: string;
    readonly jwksUri: string;
    readonly allowInsecureLoopback: boolean;
  },
  timeoutMs: number,
): string {
  return lengthPrefixedCacheKey([
    "oidc-jwks-cache-v1",
    options.issuer,
    options.jwksUri,
    options.allowInsecureLoopback ? "loopback-http" : "https-only",
    `${timeoutMs}`,
  ]);
}

function lengthPrefixedCacheKey(fields: readonly string[]): string {
  let key = "";
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    key += `${field.length}:${field}`;
  }
  return key;
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
  while (mapSize(entries) > maxEntries) {
    let oldestSettledKey: string | undefined;
    mapForEach(entries, (entry, key) => {
      if (oldestSettledKey === undefined && entry.kind === "settled") {
        oldestSettledKey = key;
      }
    });
    if (oldestSettledKey === undefined) return;
    mapDelete(entries, oldestSettledKey);
  }
}

function reserveLoadCapacity(
  entries: Map<string, CacheEntry>,
  cacheKey: string,
  maxEntries: number,
): void {
  if (mapHas(entries, cacheKey)) return;
  while (mapSize(entries) >= maxEntries) {
    let settledKey: string | undefined;
    mapForEach(entries, (entry, candidateKey) => {
      if (settledKey === undefined && entry.kind === "settled") {
        settledKey = candidateKey;
      }
    });
    if (settledKey === undefined) {
      throw new TypeError("JWKS cache pending load capacity reached");
    }
    mapDelete(entries, settledKey);
  }
}

function mapDelete<K, V>(map: Map<K, V>, key: K): boolean {
  return ReflectApply(MapPrototypeDelete, map, [key]) as boolean;
}

function mapForEach<K, V>(
  map: ReadonlyMap<K, V>,
  callback: (value: V, key: K) => void,
): void {
  ReflectApply(MapPrototypeForEach, map, [callback]);
}

function mapGet<K, V>(map: ReadonlyMap<K, V>, key: K): V | undefined {
  return ReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapHas<K>(map: ReadonlyMap<K, unknown>, key: K): boolean {
  return ReflectApply(MapPrototypeHas, map, [key]) as boolean;
}

function mapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  ReflectApply(MapPrototypeSet, map, [key, value]);
}

function mapSize(map: ReadonlyMap<unknown, unknown>): number {
  if (MapSizeGetter === undefined) throw new TypeError("Map size accessor is unavailable");
  return ReflectApply(MapSizeGetter, map, []) as number;
}

function promiseThen<T, U>(
  promise: Promise<T>,
  onFulfilled: (value: T) => U | PromiseLike<U>,
  onRejected: (reason: unknown) => U | PromiseLike<U>,
): Promise<U> {
  return ReflectApply(PromisePrototypeThen, promise, [onFulfilled, onRejected]) as Promise<U>;
}

function setHas<T>(set: ReadonlySet<T>, value: T): boolean {
  return ReflectApply(SetPrototypeHas, set, [value]) as boolean;
}

function freezeKey(key: PublicJwk): PublicJwk {
  const keyOps: readonly ["verify"] | undefined = key.key_ops === undefined
    ? undefined
    : ObjectFreeze(["verify"]);
  return ObjectFreeze({
    ...key,
    ...(keyOps === undefined ? {} : { key_ops: keyOps }),
  });
}
