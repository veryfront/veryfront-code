import { getRequestPeerProvenance } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import type { TrustedProxyAuthConfig } from "#veryfront/security/http/middleware/types.ts";
import type { ApplicationIdentity } from "./types.ts";
import { createApplicationIdentity } from "./identity.ts";

const TRUSTED_PROXY_ISSUER = "veryfront:trusted-proxy";
const MAX_SUBJECT_LENGTH = 1_024;
const MAX_PROFILE_LENGTH = 512;
const MAX_LIST_ENTRY_LENGTH = 256;
const MAX_LIST_ENTRIES = 256;
const MAX_RAW_LIST_LENGTH = 65_536;
const MAX_HEADER_NAME_LENGTH = 128;
const MAX_TRUSTED_PEERS = 256;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const DECIMAL_OCTET_PATTERN = /^(?:0|[1-9][0-9]{0,2})$/;
const IPV4_MAPPED_IPV6_PATTERN = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

const apply = Reflect.apply;
const NativeHeaders = Headers;
const NativeRequest = Request;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertySymbols = Object.getOwnPropertySymbols;
const getPrototypeOf = Object.getPrototypeOf;
const objectKeys = Object.keys;
const headersGet = NativeHeaders.prototype.get;
const rawRequestHeadersGetter = Object.getOwnPropertyDescriptor(
  NativeRequest.prototype,
  "headers",
)?.get;
const stringIncludes = String.prototype.includes;
const stringSplit = String.prototype.split;
const stringStartsWith = String.prototype.startsWith;
const stringToLowerCase = String.prototype.toLowerCase;
const stringTrim = String.prototype.trim;

if (typeof rawRequestHeadersGetter !== "function") {
  throw new TypeError("Request.prototype.headers getter is unavailable");
}
const requestHeadersGetter = rawRequestHeadersGetter;

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
      if (canonicalPeer === null || !snapshot.trustedPeers.has(canonicalPeer)) {
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
        return Object.freeze({
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
  return new Response("Unauthorized", {
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
    if (!Array.isArray(trustedPeersValue)) return null;

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

    return Object.freeze({
      trustedPeers,
      headers,
      identityHeaderNames,
    });
  } catch {
    return null;
  }
}

function readPlainObjectDescriptors(value: unknown): PropertyDescriptorMap | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const prototype = getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
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
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value <= 0 ||
    lengthDescriptor.value > MAX_TRUSTED_PEERS
  ) {
    return null;
  }

  const peers = new Set<string>();
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
      return null;
    }
    const canonical = canonicalizePeerAddress(descriptor.value);
    if (canonical === null || peers.has(canonical)) return null;
    peers.add(canonical);
  }

  for (const key of objectKeys(descriptors)) {
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

  return Object.freeze({
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
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (value === undefined || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return Object.freeze(output);
}

function normalizeHeaderName(value: string): string | null {
  if (value.length === 0 || value.length > MAX_HEADER_NAME_LENGTH) return null;
  if (!HEADER_NAME_PATTERN.test(value)) return null;
  const normalized = apply(stringToLowerCase, value, []) as string;
  if (isForbiddenIdentityHeaderName(normalized)) return null;
  return normalized;
}

function isForbiddenIdentityHeaderName(name: string): boolean {
  return name === "host" ||
    name === "forwarded" ||
    name === "via" ||
    name === "x-real-ip" ||
    (apply(stringStartsWith, name, ["x-forwarded-"]) as boolean);
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
  const unique = new Set<string>();
  for (let index = 0; index < parts.length; index += 1) {
    const entry = apply(stringTrim, parts[index]!, []) as string;
    if (entry.length === 0) continue;
    validateIdentityValue(entry, MAX_LIST_ENTRY_LENGTH, true);
    if (!unique.has(entry) && unique.size >= MAX_LIST_ENTRIES) {
      throw new TypeError("trusted-proxy identity list exceeds the entry limit");
    }
    unique.add(entry);
    output.push(entry);
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
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function canonicalizePeerAddress(hostname: string): string | null {
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
    const mappedDotted = parseCanonicalIpv4(hostname.slice(mappedPrefix.length));
    if (mappedDotted !== null) return `ipv4:${mappedDotted}`;
  }

  const ipv6 = canonicalizeIpv6(hostname);
  if (ipv6 === null) return null;
  const mapped = IPV4_MAPPED_IPV6_PATTERN.exec(ipv6);
  if (mapped !== null) {
    const high = Number.parseInt(mapped[1]!, 16);
    const low = Number.parseInt(mapped[2]!, 16);
    return `ipv4:${(high >>> 8) & 0xff}.${high & 0xff}.${(low >>> 8) & 0xff}.${low & 0xff}`;
  }
  return `ipv6:${ipv6}`;
}

function parseCanonicalIpv4(hostname: string): string | null {
  const octets = apply(stringSplit, hostname, ["."]) as string[];
  if (octets.length !== 4) return null;

  const parsed: number[] = [];
  for (const octet of octets) {
    if (!DECIMAL_OCTET_PATTERN.test(octet)) return null;
    const value = Number(octet);
    if (value > 255) return null;
    parsed.push(value);
  }
  return `${parsed[0]}.${parsed[1]}.${parsed[2]}.${parsed[3]}`;
}

function canonicalizeIpv6(hostname: string): string | null {
  if (!(apply(stringIncludes, hostname, [":"]) as boolean)) return null;
  try {
    const parsed = new URL(`http://[${hostname}]/`);
    const normalized = parsed.hostname;
    return normalized.startsWith("[") && normalized.endsWith("]")
      ? normalized.slice(1, -1).toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function isArrayIndexKey(value: string): boolean {
  if (value === "0") return true;
  if (value.length === 0 || value[0] === "0") return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 && numeric < 2 ** 32 - 1;
}
