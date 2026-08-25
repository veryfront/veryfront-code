import type { AuthClaimValue } from "./types.ts";
import { decodeAuthBase64Url, encodeAuthBase64Url } from "./base64url.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const ENVELOPE_PREFIX = "v1.";
const ENVELOPE_VERSION = 1;
const MAX_ENVELOPE_CHARS = 3_800;
const MAX_PLAINTEXT_JSON_BYTES = 2_750;
const MIN_SECRET_BYTES = 32;
const MAX_SECRET_BYTES = 1_024;
const IV_BYTES = 12;
const FUTURE_SKEW_SECONDS = 60;
const AUTH_COOKIE_SALT = textEncoder.encode("Veryfront auth-cookie v1");

export type AuthCookiePurpose = "session" | "transaction";
export type AuthCookiePayload = Readonly<{ readonly [key: string]: AuthClaimValue }>;

export interface OpenedAuthCookieEnvelope {
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly payload: AuthCookiePayload;
}

interface SealCommonOptions {
  readonly secret: string;
  readonly purpose: AuthCookiePurpose;
  readonly cookieName: string;
  readonly randomBytes?: (length: number) => Uint8Array;
}

interface SealAuthCookieEnvelopeOptions extends SealCommonOptions {
  readonly payload: AuthCookiePayload;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface OpenAuthCookieEnvelopeOptions {
  readonly secret: string;
  readonly purpose: AuthCookiePurpose;
  readonly cookieName: string;
  readonly value: string;
  readonly now: number;
  readonly maxLifetimeSeconds: number;
}

type MutableAuthCookiePayload = { [key: string]: AuthClaimValue };
type MutableAuthCookieArray = AuthClaimValue[];

interface ParseState {
  readonly seen: WeakSet<object>;
  totalValues: number;
}

export async function sealAuthCookieEnvelope(
  options: SealAuthCookieEnvelopeOptions,
): Promise<string> {
  const plaintext = JSON.stringify({
    v: ENVELOPE_VERSION,
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
    payload: options.payload,
  });
  const plaintextBytes = textEncoder.encode(plaintext);
  if (plaintextBytes.byteLength > MAX_PLAINTEXT_JSON_BYTES) {
    throw new TypeError("Auth cookie plaintext exceeds the JSON size limit");
  }

  const iv = readRandomBytes(options.randomBytes, IV_BYTES);
  const key = await deriveAuthCookieKey(options.secret, options.purpose);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(additionalData(options.purpose, options.cookieName)),
      tagLength: 128,
    },
    key,
    toArrayBuffer(plaintextBytes),
  );
  const value = `${ENVELOPE_PREFIX}${encodeAuthBase64Url(iv)}.${
    encodeAuthBase64Url(new Uint8Array(encrypted))
  }`;
  if (value.length > MAX_ENVELOPE_CHARS) {
    throw new TypeError("Auth cookie envelope exceeds the size limit");
  }
  return value;
}

export async function openAuthCookieEnvelope(
  options: OpenAuthCookieEnvelopeOptions,
): Promise<OpenedAuthCookieEnvelope> {
  if (options.value.length > MAX_ENVELOPE_CHARS) {
    throw new TypeError("Auth cookie envelope exceeds the size limit");
  }
  const { iv, ciphertext } = parseEnvelope(options.value);
  const key = await deriveAuthCookieKey(options.secret, options.purpose);

  let plaintextBytes: ArrayBuffer;
  try {
    plaintextBytes = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(additionalData(options.purpose, options.cookieName)),
        tagLength: 128,
      },
      key,
      toArrayBuffer(ciphertext),
    );
  } catch (error) {
    throw new TypeError("Auth cookie envelope could not be authenticated", { cause: error });
  }

  let decoded: string;
  try {
    decoded = textDecoder.decode(plaintextBytes);
  } catch (error) {
    throw new TypeError("Auth cookie plaintext is not valid UTF-8", { cause: error });
  }
  const plaintextLength = textEncoder.encode(decoded).byteLength;
  if (plaintextLength > MAX_PLAINTEXT_JSON_BYTES) {
    throw new TypeError("Auth cookie plaintext exceeds the JSON size limit");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch (error) {
    throw new TypeError("Auth cookie plaintext is not valid JSON", { cause: error });
  }

  const envelope = parsePlaintextEnvelope(parsed);
  validateEnvelopeTime(envelope, options.now, options.maxLifetimeSeconds);
  return Object.freeze(envelope);
}

function parseEnvelope(
  value: string,
): { readonly iv: Uint8Array; readonly ciphertext: Uint8Array } {
  if (!value.startsWith(ENVELOPE_PREFIX)) {
    throw new TypeError("Auth cookie envelope version is unsupported");
  }
  const segments = value.slice(ENVELOPE_PREFIX.length).split(".");
  if (segments.length !== 2) {
    throw new TypeError("Auth cookie envelope must contain exactly two base64url segments");
  }
  const [encodedIv, encodedCiphertext] = segments;
  if (!encodedIv || !encodedCiphertext) {
    throw new TypeError("Auth cookie envelope contains an empty segment");
  }
  const iv = decodeAuthBase64Url(encodedIv);
  if (iv.byteLength !== IV_BYTES) {
    throw new TypeError("Auth cookie envelope IV must be 96 bits");
  }
  return {
    iv,
    ciphertext: decodeAuthBase64Url(encodedCiphertext),
  };
}

async function deriveAuthCookieKey(secret: string, purpose: AuthCookiePurpose): Promise<CryptoKey> {
  const secretBytes = textEncoder.encode(secret);
  if (secretBytes.byteLength < MIN_SECRET_BYTES || secretBytes.byteLength > MAX_SECRET_BYTES) {
    throw new TypeError("Auth cookie session secret must be 32 through 1024 UTF-8 bytes");
  }
  const inputKey = await crypto.subtle.importKey("raw", secretBytes, "HKDF", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: AUTH_COOKIE_SALT,
      info: textEncoder.encode(`Veryfront auth-cookie ${purpose} v1`),
    },
    inputKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function additionalData(purpose: AuthCookiePurpose, cookieName: string): Uint8Array {
  return textEncoder.encode(`${purpose}\n${cookieName}`);
}

function readRandomBytes(
  randomBytes: ((length: number) => Uint8Array) | undefined,
  length: number,
): Uint8Array {
  const bytes = randomBytes === undefined
    ? crypto.getRandomValues(new Uint8Array(length))
    : randomBytes(length);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
    throw new TypeError("Auth cookie random byte source returned an invalid IV");
  }
  return bytes;
}

function parsePlaintextEnvelope(value: unknown): OpenedAuthCookieEnvelope {
  if (!isPlainObject(value)) {
    throw new TypeError("Auth cookie plaintext envelope must be a plain object");
  }
  const version = readOwnValue(value, "v");
  if (version !== ENVELOPE_VERSION) {
    throw new TypeError("Auth cookie plaintext envelope version is unsupported");
  }
  const issuedAt = parseEpochSeconds(readOwnValue(value, "issuedAt"), "issuedAt");
  const expiresAt = parseEpochSeconds(readOwnValue(value, "expiresAt"), "expiresAt");
  const payload = parseAuthCookiePayload(readOwnValue(value, "payload"));
  return { issuedAt, expiresAt, payload };
}

function validateEnvelopeTime(
  envelope: OpenedAuthCookieEnvelope,
  now: number,
  maxLifetimeSeconds: number,
): void {
  if (!Number.isInteger(now)) {
    throw new TypeError("Auth cookie validation clock must be integer epoch seconds");
  }
  if (!Number.isInteger(maxLifetimeSeconds) || maxLifetimeSeconds <= 0) {
    throw new TypeError("Auth cookie max lifetime must be positive integer seconds");
  }
  const lifetime = envelope.expiresAt - envelope.issuedAt;
  if (lifetime <= 0) {
    throw new TypeError("Auth cookie lifetime must be positive");
  }
  if (lifetime > maxLifetimeSeconds) {
    throw new TypeError("Auth cookie lifetime exceeds the configured bound");
  }
  if (envelope.issuedAt > now + FUTURE_SKEW_SECONDS) {
    throw new TypeError("Auth cookie issuedAt is too far in the future");
  }
  if (now >= envelope.expiresAt) {
    throw new TypeError("Auth cookie envelope is expired");
  }
}

function parseEpochSeconds(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`Auth cookie ${field} must be positive integer epoch seconds`);
  }
  return value;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function parseAuthCookiePayload(value: unknown): AuthCookiePayload {
  const state: ParseState = { seen: new WeakSet<object>(), totalValues: 0 };
  return deepFreeze(parseClaimObject(value, state, 0, "payload"));
}

function parseClaimObject(
  value: unknown,
  state: ParseState,
  depth: number,
  path: string,
): MutableAuthCookiePayload {
  if (!isPlainObject(value)) {
    throw new TypeError(`Auth cookie ${path} must be a plain object`);
  }
  if (state.seen.has(value)) {
    throw new TypeError(`Auth cookie ${path} contains a cycle`);
  }
  if (depth > 5) {
    throw new TypeError(`Auth cookie ${path} exceeds the nested depth limit`);
  }
  state.seen.add(value);
  countValue(state, path);

  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`Auth cookie ${path} contains a symbol key`);
  }
  const keys = Object.keys(descriptors);
  if (keys.length > 128) {
    throw new TypeError(`Auth cookie ${path} exceeds the key limit`);
  }

  const output: MutableAuthCookiePayload = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`Auth cookie ${path}.${key} contains an accessor property`);
    }
    Object.defineProperty(output, key, {
      value: parseClaimValue(descriptor.value, state, depth + 1, `${path}.${key}`),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  state.seen.delete(value);
  return output;
}

function parseClaimArray(
  value: readonly unknown[],
  state: ParseState,
  depth: number,
  path: string,
): MutableAuthCookieArray {
  if (state.seen.has(value)) {
    throw new TypeError(`Auth cookie ${path} contains a cycle`);
  }
  if (depth > 5) {
    throw new TypeError(`Auth cookie ${path} exceeds the nested depth limit`);
  }
  if (value.length > 256) {
    throw new TypeError(`Auth cookie ${path} exceeds the array entry limit`);
  }
  state.seen.add(value);
  countValue(state, path);

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: MutableAuthCookieArray = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`Auth cookie ${path}.${index} must be a JSON-safe data property`);
    }
    output.push(parseClaimValue(descriptor.value, state, depth + 1, `${path}.${index}`));
  }
  state.seen.delete(value);
  return output;
}

function parseClaimValue(
  value: unknown,
  state: ParseState,
  depth: number,
  path: string,
): AuthClaimValue {
  if (value === null || typeof value === "boolean") {
    countValue(state, path);
    return value;
  }
  if (typeof value === "string") {
    countValue(state, path);
    if (value.length > 2_048) {
      throw new TypeError(`Auth cookie ${path} exceeds the string length limit`);
    }
    return value;
  }
  if (typeof value === "number") {
    countValue(state, path);
    if (!Number.isFinite(value)) {
      throw new TypeError(`Auth cookie ${path} contains a non-JSON-safe number`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return parseClaimArray(value, state, depth, path);
  }
  if (isPlainObject(value)) {
    return parseClaimObject(value, state, depth, path);
  }
  throw new TypeError(`Auth cookie ${path} contains an unsupported value`);
}

function countValue(state: ParseState, path: string): void {
  state.totalValues += 1;
  if (state.totalValues > 1_024) {
    throw new TypeError(`Auth cookie ${path} exceeds the value limit`);
  }
}

function isPlainObject(value: unknown): value is { readonly [key: string]: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readOwnValue(
  value: { readonly [key: string]: unknown },
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) return undefined;
  return descriptor.value;
}

function deepFreeze<T extends AuthClaimValue>(value: T): T;
function deepFreeze<T extends AuthCookiePayload>(value: T): T;
function deepFreeze(value: AuthClaimValue | AuthCookiePayload): AuthClaimValue | AuthCookiePayload {
  if (typeof value === "object" && value !== null) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
