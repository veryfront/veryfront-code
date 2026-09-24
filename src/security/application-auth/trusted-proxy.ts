import { getRequestPeerProvenance } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import type { TrustedProxyAuthConfig } from "#veryfront/security/http/middleware/types.ts";
import type { ApplicationIdentity } from "./types.ts";
import { createApplicationIdentity } from "./identity.ts";
import { canonicalizePeerAddress } from "./peer-address.ts";
import {
  isForbiddenApplicationIdentityHeaderName,
  MAX_APPLICATION_IDENTITY_HEADER_NAME_LENGTH,
} from "./policy.ts";

export { canonicalizePeerAddress } from "./peer-address.ts";

const TRUSTED_PROXY_ISSUER = "veryfront:trusted-proxy";
const MAX_SUBJECT_LENGTH = 1_024;
const MAX_PROFILE_LENGTH = 512;
const MAX_LIST_ENTRY_LENGTH = 256;
const MAX_LIST_ENTRIES = 256;
const MAX_RAW_LIST_LENGTH = 65_536;
const MAX_TRUSTED_PEERS = 256;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

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
const stringSplit = String.prototype.split;
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
