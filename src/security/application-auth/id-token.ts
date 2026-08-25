import { type ApplicationIdentityClaimNames, createApplicationIdentity } from "./identity.ts";
import { decodeAuthBase64Url } from "./base64url.ts";
import { getJwksKeyWithFreshness, type JwksCache, type PublicJwk } from "./jwks-cache.ts";
import { parseStrictJsonObject } from "./oidc-metadata.ts";
import type { ApplicationIdentity } from "./types.ts";

const MAX_TOKEN_LENGTH = 16_384;
const MAX_HEADER_BYTES = 2_048;
const MAX_SIGNATURE_BYTES = 8_192;
const MAX_KID_LENGTH = 256;
const MAX_TYP_LENGTH = 64;
const MAX_VERIFIER_STRING_LENGTH = 2_048;
const MAX_AUDIENCES = 16;
const MAX_CLAIM_STRING_LENGTH = 2_048;
const MAX_SUBJECT_LENGTH = 255;
const MAX_NONCE_LENGTH = 256;
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 60;
const MAX_CLOCK_TOLERANCE_SECONDS = 300;
const DEFAULT_MAX_TOKEN_AGE_SECONDS = 600;
const MAX_MAX_TOKEN_AGE_SECONDS = 3_600;
const MAX_VALIDITY_WINDOW_SECONDS = 86_400;
const BASE64URL_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/u;
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7E]+$/u;
const ArrayIsArray = Array.isArray;
const NativeMap = Map;
const NativeSet = Set;
const ReflectApply = Reflect.apply;
const MapPrototypeGet = NativeMap.prototype.get;
const MapPrototypeHas = NativeMap.prototype.has;
const ObjectFreeze = Object.freeze;
const SetPrototypeAdd = NativeSet.prototype.add;
const SetPrototypeHas = NativeSet.prototype.has;
const RegExpPrototypeTest = RegExp.prototype.test;
const FORBIDDEN_HEADER_NAMES = ["crit", "b64", "jku", "jwk", "x5u", "x5c"];
const DEFAULT_ALLOWED_ALGORITHMS = ObjectFreeze(["RS256"]);
const RSA_ALGORITHMS = new NativeSet([
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
]);
const EC_SIGNATURE_BYTES = new NativeMap([
  ["ES256", 64],
  ["ES384", 96],
  ["ES512", 132],
]);
const EC_CURVE_BY_ALGORITHM = new NativeMap([
  ["ES256", "P-256"],
  ["ES384", "P-384"],
  ["ES512", "P-521"],
]);
const HASH_BY_ALGORITHM = new NativeMap([
  ["RS256", "SHA-256"],
  ["RS384", "SHA-384"],
  ["RS512", "SHA-512"],
  ["PS256", "SHA-256"],
  ["PS384", "SHA-384"],
  ["PS512", "SHA-512"],
  ["ES256", "SHA-256"],
  ["ES384", "SHA-384"],
  ["ES512", "SHA-512"],
]);
const PSS_SALT_LENGTH_BY_ALGORITHM = new NativeMap([
  ["PS256", 32],
  ["PS384", 48],
  ["PS512", 64],
]);
const CryptoSubtle = crypto.subtle;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeIncludes = String.prototype.includes;
const StringPrototypeSplit = String.prototype.split;
const StringPrototypeStartsWith = String.prototype.startsWith;
const SubtleCryptoImportKey = CryptoSubtle.importKey;
const SubtleCryptoVerify = CryptoSubtle.verify;
const TextDecoderDecode = TextDecoder.prototype.decode;
const TextEncoderEncode = TextEncoder.prototype.encode;
const TokenTextDecoder = new TextDecoder("utf-8", { fatal: true });
const TokenTextEncoder = new TextEncoder();

type JsonObject = { readonly [key: string]: unknown };
type IdTokenAlgorithm =
  | "RS256"
  | "RS384"
  | "RS512"
  | "PS256"
  | "PS384"
  | "PS512"
  | "ES256"
  | "ES384"
  | "ES512";

export interface VerifyOidcIdTokenOptions {
  readonly token: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly nonce: string;
  readonly jwksUri: string;
  readonly jwksCache: JwksCache;
  readonly allowedAlgorithms?: readonly string[];
  readonly clockToleranceSeconds?: number;
  readonly maxTokenAgeSeconds?: number;
  readonly now?: () => number;
  readonly claimNames?: ApplicationIdentityClaimNames;
  readonly allowInsecureLoopback?: boolean;
  readonly timeoutMs?: number;
}

interface ParsedToken {
  readonly signingInput: Uint8Array;
  readonly protectedHeader: JsonObject;
  readonly claims: JsonObject;
  readonly signature: Uint8Array;
}

export async function verifyOidcIdToken(
  options: VerifyOidcIdTokenOptions,
): Promise<ApplicationIdentity> {
  try {
    const issuer = parseVerifierString(options.issuer, "issuer");
    const clientId = parseVerifierString(options.clientId, "client ID");
    const currentTime = parseCurrentTime(options.now ?? (() => Date.now() / 1_000));
    const allowedAlgorithms = parseAllowedAlgorithms(options.allowedAlgorithms);
    const tolerance = parseClockTolerance(options.clockToleranceSeconds);
    const maxTokenAge = parseMaxTokenAge(options.maxTokenAgeSeconds);
    const parsed = parseCompactJws(options.token);
    const alg = parseHeaderAlgorithm(parsed.protectedHeader, allowedAlgorithms);
    const kid = parseHeaderKid(parsed.protectedHeader);
    rejectForbiddenHeaders(parsed.protectedHeader);
    validateTyp(parsed.protectedHeader.typ);
    await verifySignatureWithRefresh({
      jwksCache: options.jwksCache,
      issuer,
      jwksUri: options.jwksUri,
      allowInsecureLoopback: options.allowInsecureLoopback === true,
      timeoutMs: options.timeoutMs,
      kid,
      alg,
      signingInput: parsed.signingInput,
      signature: parsed.signature,
    });
    validateClaims(parsed.claims, {
      issuer,
      clientId,
      nonce: options.nonce,
      currentTime,
      tolerance,
      maxTokenAge,
    });
    return createApplicationIdentity({
      issuer: parsed.claims.iss,
      expectedIssuer: issuer,
      subject: parsed.claims.sub,
      claims: parsed.claims,
      claimNames: {
        email: "email",
        name: "name",
        groups: "groups",
        roles: "roles",
        ...options.claimNames,
      },
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw sanitizeVerificationError(error);
    }
    throw new TypeError("OIDC ID token verification failed", { cause: error });
  }
}

function parseVerifierString(value: string, label: "issuer" | "client ID"): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_VERIFIER_STRING_LENGTH
  ) {
    throw new TypeError(`OIDC ID token verifier ${label} must be a bounded non-empty string`);
  }
  return value;
}

function parseCurrentTime(now: () => number): number {
  const current = Math.floor(now());
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new TypeError("OIDC ID token verifier clock must return a finite non-negative value");
  }
  return current;
}

function parseCompactJws(token: string): ParsedToken {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH ||
    !isAsciiString(token)
  ) {
    throw new TypeError("OIDC ID token exceeds the size limit");
  }
  const segments = ReflectApply(StringPrototypeSplit, token, ["."]) as string[];
  if (segments.length !== 3) {
    throw new TypeError("OIDC ID token must be a compact JWS with exactly three segments");
  }
  const headerSegment = segments[0];
  const payloadSegment = segments[1];
  const signatureSegment = segments[2];
  if (
    headerSegment === undefined ||
    payloadSegment === undefined ||
    signatureSegment === undefined ||
    headerSegment.length === 0 ||
    payloadSegment.length === 0 ||
    signatureSegment.length === 0
  ) {
    throw new TypeError("OIDC ID token compact JWS segments must be non-empty");
  }
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (!regexpTest(BASE64URL_SEGMENT_PATTERN, segment)) {
      throw new TypeError("OIDC ID token compact JWS segment must use strict base64url");
    }
  }
  const headerBytes = decodeSegment(headerSegment, "protected header");
  if (headerBytes.byteLength > MAX_HEADER_BYTES) {
    throw new TypeError("OIDC ID token protected header exceeds the size limit");
  }
  const payloadBytes = decodeSegment(payloadSegment, "claims");
  const signature = decodeSegment(signatureSegment, "signature");
  if (signature.byteLength > MAX_SIGNATURE_BYTES) {
    throw new TypeError("OIDC ID token signature exceeds the size limit");
  }
  const protectedHeader = parseStrictJsonObject(
    decodeUtf8(headerBytes),
    "OIDC ID token protected header",
  );
  const claims = parseStrictJsonObject(decodeUtf8(payloadBytes), "OIDC ID token claims");
  return {
    signingInput: encodeUtf8(`${headerSegment}.${payloadSegment}`),
    protectedHeader,
    claims,
    signature,
  };
}

function decodeUtf8(bytes: Uint8Array): string {
  return ReflectApply(TextDecoderDecode, TokenTextDecoder, [bytes]) as string;
}

function encodeUtf8(value: string): Uint8Array {
  return ReflectApply(TextEncoderEncode, TokenTextEncoder, [value]) as Uint8Array;
}

function arrayIncludes<T>(values: readonly T[], expected: T): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === expected) return true;
  }
  return false;
}

function mapGet<K, V>(map: ReadonlyMap<K, V>, key: K): V | undefined {
  return ReflectApply(MapPrototypeGet, map, [key]) as V | undefined;
}

function mapHas<K>(map: ReadonlyMap<K, unknown>, key: K): boolean {
  return ReflectApply(MapPrototypeHas, map, [key]) as boolean;
}

function setAdd<T>(set: Set<T>, value: T): void {
  ReflectApply(SetPrototypeAdd, set, [value]);
}

function setHas<T>(set: ReadonlySet<T>, value: T): boolean {
  return ReflectApply(SetPrototypeHas, set, [value]) as boolean;
}

function isAsciiString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = ReflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
    if (code > 0x7F) return false;
  }
  return true;
}

function decodeSegment(segment: string, label: string): Uint8Array {
  try {
    return decodeAuthBase64Url(segment);
  } catch (error) {
    throw new TypeError(`OIDC ID token ${label} segment must use strict base64url`, {
      cause: error,
    });
  }
}

function parseAllowedAlgorithms(value: readonly string[] | undefined): readonly IdTokenAlgorithm[] {
  const algorithms = value ?? DEFAULT_ALLOWED_ALGORITHMS;
  if (algorithms.length < 1 || algorithms.length > 9) {
    throw new TypeError("OIDC ID token algorithm allowlist must contain 1 through 9 entries");
  }
  const seen = new NativeSet<string>();
  const parsed: IdTokenAlgorithm[] = [];
  for (let index = 0; index < algorithms.length; index += 1) {
    const algorithm = algorithms[index]!;
    if (!isIdTokenAlgorithm(algorithm)) {
      throw new TypeError("OIDC ID token algorithm allowlist must contain asymmetric algorithms");
    }
    if (setHas(seen, algorithm)) {
      throw new TypeError("OIDC ID token algorithm allowlist must not contain duplicates");
    }
    setAdd(seen, algorithm);
    parsed[parsed.length] = algorithm;
  }
  return ObjectFreeze(parsed);
}

function isIdTokenAlgorithm(value: string): value is IdTokenAlgorithm {
  return mapHas(HASH_BY_ALGORITHM, value);
}

function parseHeaderAlgorithm(
  header: JsonObject,
  allowedAlgorithms: readonly IdTokenAlgorithm[],
): IdTokenAlgorithm {
  const alg = header.alg;
  if (
    typeof alg !== "string" || !isIdTokenAlgorithm(alg) ||
    !arrayIncludes(allowedAlgorithms, alg)
  ) {
    throw new TypeError("OIDC ID token uses an unsupported signing algorithm");
  }
  return alg;
}

function parseHeaderKid(header: JsonObject): string | undefined {
  const kid = header.kid;
  if (kid === undefined) return undefined;
  if (typeof kid !== "string" || kid.length === 0 || kid.length > MAX_KID_LENGTH) {
    throw new TypeError("OIDC ID token protected header kid must be a bounded non-empty string");
  }
  return kid;
}

function rejectForbiddenHeaders(header: JsonObject): void {
  for (let index = 0; index < FORBIDDEN_HEADER_NAMES.length; index += 1) {
    const name = FORBIDDEN_HEADER_NAMES[index]!;
    if (header[name] !== undefined) {
      throw new TypeError("OIDC ID token protected header contains a forbidden header");
    }
  }
}

function validateTyp(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TYP_LENGTH) {
    throw new TypeError("OIDC ID token protected header typ must be a bounded string");
  }
}

async function verifySignatureWithRefresh(options: {
  readonly jwksCache: JwksCache;
  readonly issuer: string;
  readonly jwksUri: string;
  readonly allowInsecureLoopback: boolean;
  readonly timeoutMs?: number;
  readonly kid: string | undefined;
  readonly alg: IdTokenAlgorithm;
  readonly signingInput: Uint8Array;
  readonly signature: Uint8Array;
}): Promise<void> {
  const firstKey = await getJwksKeyWithFreshness(options.jwksCache, {
    issuer: options.issuer,
    jwksUri: options.jwksUri,
    kid: options.kid,
    alg: options.alg,
    allowInsecureLoopback: options.allowInsecureLoopback,
    timeoutMs: options.timeoutMs,
  });
  if (await verifySignature(firstKey.key, options.alg, options.signingInput, options.signature)) {
    return;
  }
  const refreshedKey = await getJwksKeyWithFreshness(
    options.jwksCache,
    {
      issuer: options.issuer,
      jwksUri: options.jwksUri,
      kid: options.kid,
      alg: options.alg,
      forceRefresh: true,
      allowInsecureLoopback: options.allowInsecureLoopback,
      timeoutMs: options.timeoutMs,
    },
    firstKey.freshness,
  );
  if (
    await verifySignature(refreshedKey.key, options.alg, options.signingInput, options.signature)
  ) {
    return;
  }
  throw new TypeError("OIDC ID token signature verification failed");
}

async function verifySignature(
  key: PublicJwk,
  alg: IdTokenAlgorithm,
  signingInput: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  validateKeyType(key, alg, signature);
  const cryptoKey = await ReflectApply(SubtleCryptoImportKey, CryptoSubtle, [
    "jwk",
    jwkForImport(key),
    importAlgorithm(key, alg),
    false,
    ["verify"],
  ]) as CryptoKey;
  return await ReflectApply(SubtleCryptoVerify, CryptoSubtle, [
    verifyAlgorithm(alg),
    cryptoKey,
    toArrayBuffer(signature),
    toArrayBuffer(signingInput),
  ]) as boolean;
}

function validateKeyType(key: PublicJwk, alg: IdTokenAlgorithm, signature: Uint8Array): void {
  if (setHas(RSA_ALGORITHMS, alg)) {
    if (key.kty !== "RSA") {
      throw new TypeError("OIDC ID token key type is not compatible with the signing algorithm");
    }
    return;
  }
  if (key.kty !== "EC") {
    throw new TypeError("OIDC ID token key type is not compatible with the signing algorithm");
  }
  const expectedCurve = mapGet(EC_CURVE_BY_ALGORITHM, alg);
  const expectedBytes = mapGet(EC_SIGNATURE_BYTES, alg);
  if (
    key.crv !== expectedCurve || expectedBytes === undefined ||
    signature.byteLength !== expectedBytes
  ) {
    throw new TypeError("OIDC ID token EC signature is not compatible with the signing algorithm");
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    copy[index] = bytes[index]!;
  }
  return copy.buffer;
}

function jwkForImport(key: PublicJwk): JsonWebKey {
  if (key.kty === "RSA") {
    return { kty: "RSA", n: key.n, e: key.e };
  }
  return { kty: "EC", crv: key.crv, x: key.x, y: key.y };
}

function importAlgorithm(
  key: PublicJwk,
  alg: IdTokenAlgorithm,
): RsaHashedImportParams | EcKeyImportParams {
  if (key.kty === "EC") {
    const namedCurve = mapGet(EC_CURVE_BY_ALGORITHM, alg);
    if (namedCurve === undefined) {
      throw new TypeError("OIDC ID token key type is not compatible with the signing algorithm");
    }
    return { name: "ECDSA", namedCurve };
  }
  return {
    name: stringStartsWith(alg, "PS") ? "RSA-PSS" : "RSASSA-PKCS1-v1_5",
    hash: hashFor(alg),
  };
}

function verifyAlgorithm(alg: IdTokenAlgorithm): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
  if (stringStartsWith(alg, "PS")) {
    const saltLength = mapGet(PSS_SALT_LENGTH_BY_ALGORITHM, alg);
    if (saltLength === undefined) {
      throw new TypeError("OIDC ID token uses an unsupported signing algorithm");
    }
    return { name: "RSA-PSS", saltLength };
  }
  if (stringStartsWith(alg, "ES")) return { name: "ECDSA", hash: hashFor(alg) };
  return { name: "RSASSA-PKCS1-v1_5" };
}

function hashFor(alg: IdTokenAlgorithm): string {
  const hash = mapGet(HASH_BY_ALGORITHM, alg);
  if (hash === undefined) {
    throw new TypeError("OIDC ID token uses an unsupported signing algorithm");
  }
  return hash;
}

function validateClaims(
  claims: JsonObject,
  options: {
    readonly issuer: string;
    readonly clientId: string;
    readonly nonce: string;
    readonly currentTime: number;
    readonly tolerance: number;
    readonly maxTokenAge: number;
  },
): void {
  if (claims.iss !== options.issuer) {
    throw new TypeError("OIDC ID token issuer must exactly match the configured issuer");
  }
  validateOidcAudienceClaims(claims.aud, claims.azp, options.clientId);
  validateSubject(claims.sub);
  validateNonce(claims.nonce, options.nonce);
  validateTimeClaims(claims, options.currentTime, options.tolerance, options.maxTokenAge);
}

export function validateOidcAudienceClaims(
  aud: unknown,
  azp: unknown,
  clientId: string,
): void {
  const audiences = parseAudience(aud);
  if (!arrayIncludes(audiences, clientId)) {
    throw new TypeError("OIDC ID token audience must contain the configured client ID");
  }
  if (azp !== undefined && azp !== clientId) {
    throw new TypeError("OIDC ID token azp must equal the configured client ID");
  }
  if (audiences.length > 1 && azp !== clientId) {
    throw new TypeError("OIDC ID token azp is required for multiple audiences");
  }
}

function parseAudience(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [parseBoundedClaimString(value, "audience")];
  }
  if (!ArrayIsArray(value) || value.length < 1 || value.length > MAX_AUDIENCES) {
    throw new TypeError("OIDC ID token audience must be a bounded string or string array");
  }
  const seen = new NativeSet<string>();
  const output: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    const audience = parseBoundedClaimString(entry, "audience");
    if (setHas(seen, audience)) {
      throw new TypeError("OIDC ID token audience values must be unique");
    }
    setAdd(seen, audience);
    output[output.length] = audience;
  }
  return output;
}

function validateSubject(value: unknown): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SUBJECT_LENGTH ||
    !regexpTest(PRINTABLE_ASCII_PATTERN, value)
  ) {
    throw new TypeError("OIDC ID token subject must be a printable ASCII string");
  }
}

function validateNonce(value: unknown, expected: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_NONCE_LENGTH ||
    typeof expected !== "string" ||
    expected.length === 0 ||
    expected.length > MAX_NONCE_LENGTH
  ) {
    throw new TypeError("OIDC ID token nonce must be a bounded non-empty string");
  }
  if (!constantWorkEqual(value, expected)) {
    throw new TypeError("OIDC ID token nonce does not match the transaction nonce");
  }
}

function constantWorkEqual(actual: string, expected: string): boolean {
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < actual.length; index += 1) {
    diff |= (ReflectApply(StringPrototypeCharCodeAt, actual, [index]) as number) ^
      (ReflectApply(StringPrototypeCharCodeAt, expected, [index]) as number);
  }
  return diff === 0;
}

function validateTimeClaims(
  claims: JsonObject,
  now: number,
  tolerance: number,
  maxTokenAge: number,
): void {
  const current = Math.floor(now);
  const exp = parseIntegerClaim(claims.exp, "exp");
  const iat = parseIntegerClaim(claims.iat, "iat");
  const nbf = claims.nbf === undefined ? undefined : parseIntegerClaim(claims.nbf, "nbf");
  if (exp < iat) {
    throw new TypeError("OIDC ID token validity window is invalid");
  }
  if (exp - iat > MAX_VALIDITY_WINDOW_SECONDS) {
    throw new TypeError("OIDC ID token validity window exceeds the maximum");
  }
  if (current >= exp + tolerance) {
    throw new TypeError("OIDC ID token is expired");
  }
  if (nbf !== undefined && current + tolerance < nbf) {
    throw new TypeError("OIDC ID token is not yet valid");
  }
  if (iat > current + tolerance) {
    throw new TypeError("OIDC ID token was issued in the future");
  }
  if (current - iat > maxTokenAge) {
    throw new TypeError("OIDC ID token exceeds the maximum token age");
  }
}

function parseIntegerClaim(value: unknown, claimName: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`OIDC ID token ${claimName} claim must be an integer`);
  }
  return value;
}

function parseBoundedClaimString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CLAIM_STRING_LENGTH) {
    throw new TypeError(`OIDC ID token ${label} must be a bounded non-empty string`);
  }
  return value;
}

function parseClockTolerance(value: number | undefined): number {
  const tolerance = value ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > MAX_CLOCK_TOLERANCE_SECONDS) {
    throw new TypeError("OIDC ID token clock tolerance must be 0 through 300 seconds");
  }
  return tolerance;
}

function parseMaxTokenAge(value: number | undefined): number {
  const maxTokenAge = value ?? DEFAULT_MAX_TOKEN_AGE_SECONDS;
  if (
    !Number.isInteger(maxTokenAge) || maxTokenAge < 1 || maxTokenAge > MAX_MAX_TOKEN_AGE_SECONDS
  ) {
    throw new TypeError("OIDC ID token maximum token age must be 1 through 3600 seconds");
  }
  return maxTokenAge;
}

function sanitizeVerificationError(error: TypeError): TypeError {
  if (stringStartsWith(error.message, "OIDC ID token")) {
    return error;
  }
  if (stringStartsWith(error.message, "Application identity")) {
    return error;
  }
  if (
    stringIncludes(error.message, "JWKS key type") || stringIncludes(error.message, "compatible")
  ) {
    return new TypeError("OIDC ID token key verification failed", { cause: error });
  }
  if (stringIncludes(error.message, "JWKS")) {
    return new TypeError("OIDC ID token verification failed", { cause: error });
  }
  return new TypeError("OIDC ID token verification failed", { cause: error });
}

function regexpTest(pattern: RegExp, value: string): boolean {
  return ReflectApply(RegExpPrototypeTest, pattern, [value]) as boolean;
}

function stringIncludes(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeIncludes, value, [search]) as boolean;
}

function stringStartsWith(value: string, search: string): boolean {
  return ReflectApply(StringPrototypeStartsWith, value, [search]) as boolean;
}
