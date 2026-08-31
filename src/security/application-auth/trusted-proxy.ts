import { getRequestPeerProvenance } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import type { TrustedProxyAuthConfig } from "#veryfront/security/http/middleware/types.ts";
import type { ApplicationIdentity } from "./types.ts";
import { createApplicationIdentity } from "./identity.ts";
import {
  isForbiddenApplicationIdentityHeaderName,
  MAX_APPLICATION_IDENTITY_HEADER_NAME_LENGTH,
} from "./policy.ts";

const TRUSTED_PROXY_ISSUER = "veryfront:trusted-proxy";
const MAX_SUBJECT_LENGTH = 1_024;
const MAX_PROFILE_LENGTH = 512;
const MAX_LIST_ENTRY_LENGTH = 256;
const MAX_LIST_ENTRIES = 256;
const MAX_RAW_LIST_LENGTH = 65_536;
const MAX_TRUSTED_PEERS = 256;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const DECIMAL_OCTET_PATTERN = /^(?:0|[1-9][0-9]{0,2})$/;
const IPV4_MAPPED_IPV6_PATTERN = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const arrayPush = Array.prototype.push;
const NativeNumber = Number;
const NativeResponse = Response;
const NativeSet = Set;
const NativeWeakSet = WeakSet;
const NativeHeaders = Headers;
const NativeRequest = Request;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertySymbols = Object.getOwnPropertySymbols;
const getPrototypeOf = Object.getPrototypeOf;
const objectFreeze = Object.freeze;
const objectKeys = Object.keys;
const objectPrototype = Object.prototype;
const headersGet = NativeHeaders.prototype.get;
const numberIsSafeInteger = NativeNumber.isSafeInteger;
const numberParseInt = NativeNumber.parseInt;
const numberToString = NativeNumber.prototype.toString;
const regexpExec = RegExp.prototype.exec;
const regexpTest = RegExp.prototype.test;
const setAdd = NativeSet.prototype.add;
const setHas = NativeSet.prototype.has;
const weakSetAdd = NativeWeakSet.prototype.add;
const weakSetHas = NativeWeakSet.prototype.has;
const rawRequestHeadersGetter = getOwnPropertyDescriptor(
  NativeRequest.prototype,
  "headers",
)?.get;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringIncludes = String.prototype.includes;
const stringSlice = String.prototype.slice;
const stringSplit = String.prototype.split;
const stringStartsWith = String.prototype.startsWith;
const stringToLowerCase = String.prototype.toLowerCase;
const stringTrim = String.prototype.trim;

const admittedTrustedProxyRequests = new NativeWeakSet<Request>();
const EMPTY_IDENTITY_HEADER_NAMES = objectFreeze([] as string[]);

if (typeof rawRequestHeadersGetter !== "function") {
  throw new TypeError("Request.prototype.headers getter is unavailable");
}
const requestHeadersGetter = rawRequestHeadersGetter;

function arrayAppend<T>(array: T[], value: T): void {
  apply(arrayPush, array, [value]);
}

function setContains<T>(set: ReadonlySet<T>, value: T): boolean {
  return apply(setHas, set, [value]) as boolean;
}

function setInsert<T>(set: Set<T>, value: T): void {
  apply(setAdd, set, [value]);
}

export interface TrustedProxyAdmission {
  readonly identity: ApplicationIdentity;
  readonly identityHeaderNames: readonly string[];
}

export interface TrustedProxyApplicationAuthRuntime {
  admitRequest(request: Request): Promise<TrustedProxyAdmission | Response>;
}

export interface TrustedProxyApplicationAuthRuntimeOptions {
  readonly config: TrustedProxyAuthConfig;
}

export function markTrustedProxyApplicationAuthAdmittedRequest(request: Request): void {
  apply(weakSetAdd, admittedTrustedProxyRequests, [request]);
}

export function isTrustedProxyApplicationAuthAdmittedRequest(request: Request): boolean {
  return apply(weakSetHas, admittedTrustedProxyRequests, [request]) as boolean;
}

/** Snapshot the configured identity headers before request admission runs. */
export function getTrustedProxyApplicationIdentityHeaderNames(
  config: TrustedProxyAuthConfig,
): readonly string[] {
  try {
    const root = readPlainObjectDescriptors(config);
    const headers = snapshotHeaders(readDataProperty(root, "headers"));
    if (headers === null) return EMPTY_IDENTITY_HEADER_NAMES;
    return freezeUniqueHeaderNames([
      headers.subject,
      headers.email,
      headers.name,
      headers.groups,
      headers.roles,
    ]) ?? EMPTY_IDENTITY_HEADER_NAMES;
  } catch {
    return EMPTY_IDENTITY_HEADER_NAMES;
  }
}

interface TrustedProxyConfigSnapshot {
  readonly trustedPeers: ReadonlySet<string>;
  readonly headers: {
    readonly subject: string;
    readonly email?: string;
    readonly name?: string;
    readonly groups?: string;
    readonly roles?: string;
  };
  readonly identityHeaderNames: readonly string[];
}

export function createTrustedProxyApplicationAuthRuntime(
  options: TrustedProxyApplicationAuthRuntimeOptions,
): TrustedProxyApplicationAuthRuntime {
  const snapshot = snapshotConfig(options.config);

  return {
    async admitRequest(request: Request): Promise<TrustedProxyAdmission | Response> {
      if (snapshot === null) return unauthorized();

      const peer = getRequestPeerProvenance(request);
      const canonicalPeer = peer === undefined ? null : canonicalizePeerAddress(peer.hostname);
      if (canonicalPeer === null || !setContains(snapshot.trustedPeers, canonicalPeer)) {
        return unauthorized();
      }

      try {
        const headers = apply(requestHeadersGetter, request, []) as Headers;
        const claims = readClaims(headers, snapshot.headers);
        const identity = createApplicationIdentity({
          issuer: TRUSTED_PROXY_ISSUER,
          expectedIssuer: TRUSTED_PROXY_ISSUER,
          subject: claims.sub,
          claims,
          claimNames: {
            email: snapshot.headers.email === undefined ? undefined : "email",
            name: snapshot.headers.name === undefined ? undefined : "name",
            groups: snapshot.headers.groups === undefined ? undefined : "groups",
            roles: snapshot.headers.roles === undefined ? undefined : "roles",
          },
        });
        return objectFreeze({
          identity,
          identityHeaderNames: snapshot.identityHeaderNames,
        });
      } catch {
        return unauthorized();
      }
    },
  };
}

function unauthorized(): Response {
  return new NativeResponse("Unauthorized", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function snapshotConfig(config: TrustedProxyAuthConfig): TrustedProxyConfigSnapshot | null {
  try {
    const root = readPlainObjectDescriptors(config);
    const trustedPeersValue = readDataProperty(root, "trustedPeers");
    const headersValue = readDataProperty(root, "headers");
    if (!arrayIsArray(trustedPeersValue)) return null;

    const trustedPeers = snapshotTrustedPeers(trustedPeersValue);
    if (trustedPeers === null) return null;

    const headers = snapshotHeaders(headersValue);
    if (headers === null) return null;

    const identityHeaderNames = freezeUniqueHeaderNames([
      headers.subject,
      headers.email,
      headers.name,
      headers.groups,
      headers.roles,
    ]);
    if (identityHeaderNames === null) return null;

    return objectFreeze({
      trustedPeers,
      headers,
      identityHeaderNames,
    });
  } catch {
    return null;
  }
}

function readPlainObjectDescriptors(value: unknown): PropertyDescriptorMap | null {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) return null;
  const prototype = getPrototypeOf(value);
  if (prototype !== objectPrototype && prototype !== null) return null;
  if (getOwnPropertySymbols(value).length > 0) return null;
  return getOwnPropertyDescriptors(value);
}

function readDataProperty(descriptors: PropertyDescriptorMap | null, name: string): unknown {
  if (descriptors === null) return undefined;
  const descriptor = descriptors[name];
  if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
  return descriptor.value;
}

function snapshotTrustedPeers(value: readonly unknown[]): ReadonlySet<string> | null {
  if (getOwnPropertySymbols(value).length > 0) return null;
  const descriptors = getOwnPropertyDescriptors(value);
  const lengthDescriptor = getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !numberIsSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value <= 0 ||
    lengthDescriptor.value > MAX_TRUSTED_PEERS
  ) {
    return null;
  }

  const peers = new NativeSet<string>();
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
      return null;
    }
    const canonical = canonicalizePeerAddress(descriptor.value);
    if (canonical === null || setContains(peers, canonical)) return null;
    setInsert(peers, canonical);
  }

  const keys = objectKeys(descriptors);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (key === "length" || isArrayIndexKey(key)) continue;
    return null;
  }
  return peers;
}

function snapshotHeaders(value: unknown): TrustedProxyConfigSnapshot["headers"] | null {
  const descriptors = readPlainObjectDescriptors(value);
  if (descriptors === null) return null;
  const subject = readHeaderConfig(descriptors, "subject", true);
  if (subject === null || subject === undefined) return null;

  const email = readHeaderConfig(descriptors, "email", false);
  const name = readHeaderConfig(descriptors, "name", false);
  const groups = readHeaderConfig(descriptors, "groups", false);
  const roles = readHeaderConfig(descriptors, "roles", false);
  if (email === null || name === null || groups === null || roles === null) return null;

  return objectFreeze({
    subject,
    ...(email === undefined ? {} : { email }),
    ...(name === undefined ? {} : { name }),
    ...(groups === undefined ? {} : { groups }),
    ...(roles === undefined ? {} : { roles }),
  });
}

function readHeaderConfig(
  descriptors: PropertyDescriptorMap,
  name: string,
  required: boolean,
): string | undefined | null {
  const descriptor = descriptors[name];
  if (descriptor === undefined) return required ? null : undefined;
  if (!descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") {
    return null;
  }
  return normalizeHeaderName(descriptor.value);
}

function freezeUniqueHeaderNames(
  values: readonly (string | undefined)[],
): readonly string[] | null {
  const seen = new NativeSet<string>();
  const output: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined || setContains(seen, value)) continue;
    setInsert(seen, value);
    arrayAppend(output, value);
  }
  return objectFreeze(output);
}

function normalizeHeaderName(value: string): string | null {
  if (value.length === 0 || value.length > MAX_APPLICATION_IDENTITY_HEADER_NAME_LENGTH) {
    return null;
  }
  if (!(apply(regexpTest, HEADER_NAME_PATTERN, [value]) as boolean)) return null;
  const normalized = apply(stringToLowerCase, value, []) as string;
  if (isForbiddenApplicationIdentityHeaderName(normalized)) return null;
  return normalized;
}

function readClaims(
  headers: Headers,
  names: TrustedProxyConfigSnapshot["headers"],
): Record<string, string | readonly string[]> {
  const subject = readRequiredHeader(headers, names.subject, MAX_SUBJECT_LENGTH);
  const claims: Record<string, string | readonly string[]> = { sub: subject };

  if (names.email !== undefined) {
    const email = readOptionalHeader(headers, names.email, MAX_PROFILE_LENGTH);
    if (email !== undefined) claims.email = email;
  }
  if (names.name !== undefined) {
    const name = readOptionalHeader(headers, names.name, MAX_PROFILE_LENGTH);
    if (name !== undefined) claims.name = name;
  }
  if (names.groups !== undefined) {
    const groups = readOptionalListHeader(headers, names.groups);
    if (groups !== undefined) claims.groups = groups;
  }
  if (names.roles !== undefined) {
    const roles = readOptionalListHeader(headers, names.roles);
    if (roles !== undefined) claims.roles = roles;
  }
  return claims;
}

function readRequiredHeader(headers: Headers, name: string, maxLength: number): string {
  const value = readOptionalHeader(headers, name, maxLength);
  if (value === undefined) throw new TypeError("missing trusted-proxy identity subject");
  return value;
}

function readOptionalHeader(headers: Headers, name: string, maxLength: number): string | undefined {
  const value = apply(headersGet, headers, [name]) as string | null;
  if (value === null) return undefined;
  validateIdentityValue(value, maxLength, true);
  const normalized = apply(stringTrim, value, []) as string;
  validateIdentityValue(normalized, maxLength, false);
  if (normalized.length === 0) return undefined;
  return normalized;
}

function readOptionalListHeader(headers: Headers, name: string): readonly string[] | undefined {
  const value = apply(headersGet, headers, [name]) as string | null;
  if (value === null) return undefined;
  if (value.length > MAX_RAW_LIST_LENGTH || hasControlCharacter(value)) {
    throw new TypeError("invalid trusted-proxy identity list");
  }

  const parts = apply(stringSplit, value, [","]) as string[];
  const output: string[] = [];
  const unique = new NativeSet<string>();
  for (let index = 0; index < parts.length; index += 1) {
    const entry = apply(stringTrim, parts[index]!, []) as string;
    if (entry.length === 0) continue;
    validateIdentityValue(entry, MAX_LIST_ENTRY_LENGTH, true);
    if (!setContains(unique, entry) && unique.size >= MAX_LIST_ENTRIES) {
      throw new TypeError("trusted-proxy identity list exceeds the entry limit");
    }
    if (setContains(unique, entry)) continue;
    setInsert(unique, entry);
    arrayAppend(output, entry);
  }
  return output;
}

function validateIdentityValue(value: string, maxLength: number, allowEmpty: boolean): void {
  if (
    (!allowEmpty && value.length === 0) || value.length > maxLength || hasControlCharacter(value)
  ) {
    throw new TypeError("invalid trusted-proxy identity value");
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function canonicalizePeerAddress(hostname: string): string | null {
  if (hostname.length === 0 || hostname !== (apply(stringTrim, hostname, []) as string)) {
    return null;
  }
  if (
    apply(stringIncludes, hostname, ["/"]) as boolean ||
    apply(stringIncludes, hostname, ["%"]) as boolean ||
    apply(stringIncludes, hostname, ["["]) as boolean ||
    apply(stringIncludes, hostname, ["]"]) as boolean
  ) {
    return null;
  }

  const ipv4 = parseCanonicalIpv4(hostname);
  if (ipv4 !== null) return `ipv4:${ipv4}`;

  const mappedPrefix = "::ffff:";
  const lower = apply(stringToLowerCase, hostname, []) as string;
  if (apply(stringStartsWith, lower, [mappedPrefix]) as boolean) {
    const mappedDotted = parseCanonicalIpv4(
      apply(stringSlice, hostname, [mappedPrefix.length]) as string,
    );
    if (mappedDotted !== null) return `ipv4:${mappedDotted}`;
  }

  const ipv6 = canonicalizeIpv6(hostname);
  if (ipv6 === null) return null;
  const mapped = apply(regexpExec, IPV4_MAPPED_IPV6_PATTERN, [ipv6]) as RegExpExecArray | null;
  if (mapped !== null) {
    const high = apply(numberParseInt, NativeNumber, [mapped[1]!, 16]) as number;
    const low = apply(numberParseInt, NativeNumber, [mapped[2]!, 16]) as number;
    return `ipv4:${(high >>> 8) & 0xff}.${high & 0xff}.${(low >>> 8) & 0xff}.${low & 0xff}`;
  }
  return `ipv6:${ipv6}`;
}

function parseCanonicalIpv4(hostname: string): string | null {
  const octets = apply(stringSplit, hostname, ["."]) as string[];
  if (octets.length !== 4) return null;

  const parsed: number[] = [];
  for (let index = 0; index < octets.length; index += 1) {
    const octet = octets[index]!;
    if (!(apply(regexpTest, DECIMAL_OCTET_PATTERN, [octet]) as boolean)) return null;
    const value = apply(NativeNumber, undefined, [octet]) as number;
    if (value > 255) return null;
    arrayAppend(parsed, value);
  }
  return `${parsed[0]}.${parsed[1]}.${parsed[2]}.${parsed[3]}`;
}

function canonicalizeIpv6(hostname: string): string | null {
  if (!(apply(stringIncludes, hostname, [":"]) as boolean)) return null;
  const words = parseIpv6Words(hostname);
  return words === null ? null : formatIpv6Words(words);
}

function isArrayIndexKey(value: string): boolean {
  if (value === "0") return true;
  if (value.length === 0 || value[0] === "0") return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    if (code < 48 || code > 57) return false;
  }
  const numeric = apply(NativeNumber, undefined, [value]) as number;
  return numberIsSafeInteger(numeric) && numeric >= 0 && numeric < 2 ** 32 - 1;
}

function parseIpv6Words(hostname: string): readonly number[] | null {
  const doubleColonParts = apply(stringSplit, hostname, ["::"]) as string[];
  if (doubleColonParts.length > 2) return null;

  const left = parseIpv6WordSide(doubleColonParts[0]!);
  if (left === null) return null;
  const right = doubleColonParts.length === 2 ? parseIpv6WordSide(doubleColonParts[1]!) : [];
  if (right === null) return null;

  if (doubleColonParts.length === 1) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;

  const words: number[] = [];
  for (let index = 0; index < left.length; index += 1) arrayAppend(words, left[index]!);
  for (let index = 0; index < missing; index += 1) arrayAppend(words, 0);
  for (let index = 0; index < right.length; index += 1) arrayAppend(words, right[index]!);
  return words;
}

function parseIpv6WordSide(value: string): number[] | null {
  if (value.length === 0) return [];
  const rawWords = apply(stringSplit, value, [":"]) as string[];
  const words: number[] = [];
  for (let index = 0; index < rawWords.length; index += 1) {
    const rawWord = rawWords[index]!;
    if (rawWord.length === 0 || rawWord.length > 4) return null;
    if (!(apply(regexpTest, /^[0-9a-fA-F]{1,4}$/, [rawWord]) as boolean)) return null;
    const word = apply(numberParseInt, NativeNumber, [rawWord, 16]) as number;
    if (!numberIsSafeInteger(word) || word < 0 || word > 0xffff) return null;
    arrayAppend(words, word);
  }
  return words;
}

function formatIpv6Words(words: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;

  for (let index = 0; index <= words.length; index += 1) {
    if (index < words.length && words[index] === 0) {
      if (currentStart === -1) currentStart = index;
      currentLength += 1;
      continue;
    }
    if (currentLength > bestLength && currentLength > 1) {
      bestStart = currentStart;
      bestLength = currentLength;
    }
    currentStart = -1;
    currentLength = 0;
  }

  if (bestStart === -1) return joinIpv6Words(words, 0, words.length);

  const left = joinIpv6Words(words, 0, bestStart);
  const right = joinIpv6Words(words, bestStart + bestLength, words.length);
  if (left.length === 0 && right.length === 0) return "::";
  if (left.length === 0) return `::${right}`;
  if (right.length === 0) return `${left}::`;
  return `${left}::${right}`;
}

function joinIpv6Words(words: readonly number[], start: number, end: number): string {
  let output = "";
  for (let index = start; index < end; index += 1) {
    if (index > start) output += ":";
    output += apply(numberToString, words[index]!, [16]) as string;
  }
  return output;
}
