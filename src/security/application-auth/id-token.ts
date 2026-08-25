import { type ApplicationIdentityClaimNames, createApplicationIdentity } from "./identity.ts";
import { decodeAuthBase64Url } from "./base64url.ts";
import { type JwksCache, type PublicJwk } from "./jwks-cache.ts";
import { parseStrictJsonObject } from "./oidc-metadata.ts";
import type { ApplicationIdentity } from "./types.ts";

const MAX_TOKEN_LENGTH = 16_384;
const MAX_HEADER_BYTES = 2_048;
const MAX_SIGNATURE_BYTES = 8_192;
const MAX_KID_LENGTH = 256;
const MAX_TYP_LENGTH = 64;
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
const FORBIDDEN_HEADER_NAMES = new Set(["crit", "b64", "jku", "jwk", "x5u", "x5c"]);
const DEFAULT_ALLOWED_ALGORITHMS = Object.freeze(["RS256"]);
const RSA_ALGORITHMS = new Set(["RS256", "RS384", "RS512", "PS256", "PS384", "PS512"]);
const EC_SIGNATURE_BYTES = new Map([
  ["ES256", 64],
  ["ES384", 96],
  ["ES512", 132],
]);
const EC_CURVE_BY_ALGORITHM = new Map([
  ["ES256", "P-256"],
  ["ES384", "P-384"],
  ["ES512", "P-521"],
]);
const HASH_BY_ALGORITHM = new Map([
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
const PSS_SALT_LENGTH_BY_ALGORITHM = new Map([
  ["PS256", 32],
  ["PS384", 48],
  ["PS512", 64],
]);

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
      jwksUri: options.jwksUri,
      timeoutMs: options.timeoutMs,
      kid,
      alg,
      signingInput: parsed.signingInput,
      signature: parsed.signature,
    });
    validateClaims(parsed.claims, {
      issuer: options.issuer,
      clientId: options.clientId,
      nonce: options.nonce,
      now: options.now ?? (() => Math.floor(Date.now() / 1_000)),
      tolerance,
      maxTokenAge,
    });
    return createApplicationIdentity({
      issuer: parsed.claims.iss,
      expectedIssuer: options.issuer,
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

function parseCompactJws(token: string): ParsedToken {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_LENGTH ||
    !isAsciiString(token)
  ) {
    throw new TypeError("OIDC ID token exceeds the size limit");
  }
  const segments = token.split(".");
  if (segments.length !== 3) {
    throw new TypeError("OIDC ID token must be a compact JWS with exactly three segments");
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments;
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
  for (const segment of segments) {
    if (segment.includes("=") || !BASE64URL_SEGMENT_PATTERN.test(segment)) {
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
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const protectedHeader = parseStrictJsonObject(
    decoder.decode(headerBytes),
    "OIDC ID token protected header",
  );
  const claims = parseStrictJsonObject(decoder.decode(payloadBytes), "OIDC ID token claims");
  return {
    signingInput: new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
    protectedHeader,
    claims,
    signature,
  };
}

function isAsciiString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
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
  const seen = new Set<string>();
  const parsed: IdTokenAlgorithm[] = [];
  for (const algorithm of algorithms) {
    if (!isIdTokenAlgorithm(algorithm)) {
      throw new TypeError("OIDC ID token algorithm allowlist must contain asymmetric algorithms");
    }
    if (seen.has(algorithm)) {
      throw new TypeError("OIDC ID token algorithm allowlist must not contain duplicates");
    }
    seen.add(algorithm);
    parsed.push(algorithm);
  }
  return Object.freeze(parsed);
}

function isIdTokenAlgorithm(value: string): value is IdTokenAlgorithm {
  return HASH_BY_ALGORITHM.has(value);
}

function parseHeaderAlgorithm(
  header: JsonObject,
  allowedAlgorithms: readonly IdTokenAlgorithm[],
): IdTokenAlgorithm {
  const alg = header.alg;
  if (typeof alg !== "string" || !isIdTokenAlgorithm(alg) || !allowedAlgorithms.includes(alg)) {
    throw new TypeError("OIDC ID token uses an unsupported signing algorithm");
  }
  return alg;
}

function parseHeaderKid(header: JsonObject): string {
  const kid = header.kid;
  if (typeof kid !== "string" || kid.length === 0 || kid.length > MAX_KID_LENGTH) {
    throw new TypeError("OIDC ID token protected header kid must be a bounded non-empty string");
  }
  return kid;
}

function rejectForbiddenHeaders(header: JsonObject): void {
  for (const name of FORBIDDEN_HEADER_NAMES) {
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
  readonly jwksUri: string;
  readonly timeoutMs?: number;
  readonly kid: string;
  readonly alg: IdTokenAlgorithm;
  readonly signingInput: Uint8Array;
  readonly signature: Uint8Array;
}): Promise<void> {
  const firstKey = await options.jwksCache.getKey({
    jwksUri: options.jwksUri,
    kid: options.kid,
    alg: options.alg,
    timeoutMs: options.timeoutMs,
  });
  if (await verifySignature(firstKey, options.alg, options.signingInput, options.signature)) {
    return;
  }
  const refreshedKey = await options.jwksCache.getKey({
    jwksUri: options.jwksUri,
    kid: options.kid,
    alg: options.alg,
    forceRefresh: true,
    timeoutMs: options.timeoutMs,
  });
  if (await verifySignature(refreshedKey, options.alg, options.signingInput, options.signature)) {
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
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwkForImport(key),
    importAlgorithm(key, alg),
    false,
    ["verify"],
  );
  return await crypto.subtle.verify(
    verifyAlgorithm(alg),
    cryptoKey,
    toArrayBuffer(signature),
    toArrayBuffer(signingInput),
  );
}

function validateKeyType(key: PublicJwk, alg: IdTokenAlgorithm, signature: Uint8Array): void {
  if (RSA_ALGORITHMS.has(alg)) {
    if (key.kty !== "RSA") {
      throw new TypeError("OIDC ID token key type is not compatible with the signing algorithm");
    }
    return;
  }
  if (key.kty !== "EC") {
    throw new TypeError("OIDC ID token key type is not compatible with the signing algorithm");
  }
  const expectedCurve = EC_CURVE_BY_ALGORITHM.get(alg);
  const expectedBytes = EC_SIGNATURE_BYTES.get(alg);
  if (
    key.crv !== expectedCurve || expectedBytes === undefined ||
    signature.byteLength !== expectedBytes
  ) {
    throw new TypeError("OIDC ID token EC signature is not compatible with the signing algorithm");
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
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
    const namedCurve = EC_CURVE_BY_ALGORITHM.get(alg);
    if (namedCurve === undefined) {
      throw new TypeError("OIDC ID token key type is not compatible with the signing algorithm");
    }
    return { name: "ECDSA", namedCurve };
  }
  return {
    name: alg.startsWith("PS") ? "RSA-PSS" : "RSASSA-PKCS1-v1_5",
    hash: hashFor(alg),
  };
}

function verifyAlgorithm(alg: IdTokenAlgorithm): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
  if (alg.startsWith("PS")) {
    const saltLength = PSS_SALT_LENGTH_BY_ALGORITHM.get(alg);
    if (saltLength === undefined) {
      throw new TypeError("OIDC ID token uses an unsupported signing algorithm");
    }
    return { name: "RSA-PSS", saltLength };
  }
  if (alg.startsWith("ES")) return { name: "ECDSA", hash: hashFor(alg) };
  return { name: "RSASSA-PKCS1-v1_5" };
}

function hashFor(alg: IdTokenAlgorithm): string {
  const hash = HASH_BY_ALGORITHM.get(alg);
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
    readonly now: () => number;
    readonly tolerance: number;
    readonly maxTokenAge: number;
  },
): void {
  if (claims.iss !== options.issuer) {
    throw new TypeError("OIDC ID token issuer must exactly match the configured issuer");
  }
  validateAudience(claims.aud, claims.azp, options.clientId);
  validateSubject(claims.sub);
  validateNonce(claims.nonce, options.nonce);
  validateTimeClaims(claims, options.now(), options.tolerance, options.maxTokenAge);
}

function validateAudience(aud: unknown, azp: unknown, clientId: string): void {
  const audiences = parseAudience(aud);
  if (!audiences.includes(clientId)) {
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
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_AUDIENCES) {
    throw new TypeError("OIDC ID token audience must be a bounded string or string array");
  }
  const seen = new Set<string>();
  const output: string[] = [];
  for (const entry of value) {
    const audience = parseBoundedClaimString(entry, "audience");
    if (seen.has(audience)) {
      throw new TypeError("OIDC ID token audience values must be unique");
    }
    seen.add(audience);
    output.push(audience);
  }
  return output;
}

function validateSubject(value: unknown): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SUBJECT_LENGTH ||
    !PRINTABLE_ASCII_PATTERN.test(value)
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
  const actualBytes = new TextEncoder().encode(actual);
  const expectedBytes = new TextEncoder().encode(expected);
  if (actualBytes.byteLength !== expectedBytes.byteLength) return false;
  let diff = 0;
  for (let index = 0; index < actualBytes.byteLength; index += 1) {
    diff |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
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
  if (current > exp + tolerance) {
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
  if (typeof value !== "number" || !Number.isInteger(value)) {
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
  if (error.message.startsWith("OIDC ID token")) {
    return error;
  }
  if (error.message.startsWith("Application identity")) {
    return error;
  }
  if (error.message.includes("JWKS key type") || error.message.includes("compatible")) {
    return new TypeError("OIDC ID token key verification failed", { cause: error });
  }
  if (error.message.includes("JWKS")) {
    return new TypeError("OIDC ID token verification failed", { cause: error });
  }
  return new TypeError("OIDC ID token verification failed", { cause: error });
}
