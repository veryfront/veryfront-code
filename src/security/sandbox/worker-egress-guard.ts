/**
 * Worker network egress guard.
 *
 * Project workers need outbound network access for public API calls, but user
 * code must not reach host-internal networks or cloud metadata endpoints.
 *
 * @module security/sandbox/worker-egress-guard
 */

import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { resolveHostAddresses } from "#veryfront/platform/compat/dns.ts";

export const WORKER_INTERNAL_EGRESS_OVERRIDE_ENV = "VERYFRONT_WORKER_ALLOW_INTERNAL_EGRESS";

export class WorkerEgressBlockedError extends Error {
  override name = "WorkerEgressBlockedError";
}

export type ResolveWorkerHost = (hostname: string) => Promise<string[]>;

export interface WorkerEgressGuardOptions {
  allowInternalEgress?: boolean;
  resolveHost?: ResolveWorkerHost;
}

const guardInstalled = Symbol.for("veryfront.workerEgressGuardInstalled");
const guardedFetch = Symbol.for("veryfront.workerEgressGuard.fetch");
const guardedConnect = Symbol.for("veryfront.workerEgressGuard.connect");
const guardedConnectTls = Symbol.for("veryfront.workerEgressGuard.connectTls");

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

export function isInternalEgressOverrideEnabled(value: string | undefined): boolean {
  if (value === undefined) return false;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function stripIpv6Zone(value: string): string {
  const zoneIndex = value.indexOf("%");
  return zoneIndex === -1 ? value : value.slice(0, zoneIndex);
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

function parseIpv6(value: string): number[] | null {
  let normalized = stripIpv6Zone(stripIpv6Brackets(value)).toLowerCase();

  const lastColon = normalized.lastIndexOf(":");
  const dottedSuffix = lastColon === -1 ? "" : normalized.slice(lastColon + 1);
  if (dottedSuffix.includes(".")) {
    const octets = parseIpv4(dottedSuffix);
    if (!octets) return null;
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    normalized = `${normalized.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const compressionIndex = normalized.indexOf("::");
  let parts: string[];
  if (compressionIndex !== -1) {
    if (normalized.indexOf("::", compressionIndex + 2) !== -1) return null;
    const leftText = normalized.slice(0, compressionIndex);
    const rightText = normalized.slice(compressionIndex + 2);
    const left = leftText ? leftText.split(":") : [];
    const right = rightText ? rightText.split(":") : [];
    const omitted = 8 - left.length - right.length;
    if (omitted < 1) return null;
    parts = [...left, ...Array<string>(omitted).fill("0"), ...right];
  } else {
    parts = normalized.split(":");
    if (parts.length !== 8) return null;
  }

  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }
  return parts.map((part) => Number.parseInt(part, 16));
}

function isPrivateIpv4(octets: number[]): boolean {
  const [a = -1, b = -1] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    // 100.64.0.0/10 — CGNAT shared address space (RFC 6598)
    (a === 100 && b >= 64 && b <= 127) ||
    // 198.18.0.0/15 — benchmarking range (RFC 2544)
    (a === 198 && (b === 18 || b === 19)) ||
    a === 0
  );
}

function isInternalIpv6(value: string): boolean {
  const hextets = parseIpv6(value);
  if (!hextets) return false;

  const isUnspecified = hextets.every((hextet) => hextet === 0);
  const isLoopback = hextets.slice(0, 7).every((hextet) => hextet === 0) &&
    hextets[7] === 1;
  if (isUnspecified || isLoopback) return true;

  const isIpv4Mapped = hextets.slice(0, 5).every((hextet) => hextet === 0) &&
    hextets[5] === 0xffff;
  if (isIpv4Mapped) {
    const high = hextets[6] ?? 0;
    const low = hextets[7] ?? 0;
    return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }

  const firstHextet = hextets[0] ?? 0;

  // fe80::/10 link-local, fc00::/7 unique local.
  return (firstHextet & 0xffc0) === 0xfe80 || (firstHextet & 0xfe00) === 0xfc00;
}

export function isInternalEgressIp(address: string): boolean {
  const host = stripIpv6Zone(stripIpv6Brackets(address.trim().toLowerCase()));
  const ipv4 = parseIpv4(host);
  if (ipv4) return isPrivateIpv4(ipv4);
  return host.includes(":") && isInternalIpv6(host);
}

function isIpLiteral(address: string): boolean {
  const host = stripIpv6Zone(stripIpv6Brackets(address.trim().toLowerCase()));
  return parseIpv4(host) !== null || parseIpv6(host) !== null;
}

function isLocalhostName(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost");
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  return await resolveHostAddresses(hostname);
}

function getUrlHostname(input: string | URL | Request): string | null {
  const url = input instanceof URL
    ? input
    : input instanceof Request
    ? new URL(input.url)
    : new URL(String(input));

  if (
    url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ws:" &&
    url.protocol !== "wss:"
  ) {
    return null;
  }

  return stripIpv6Brackets(url.hostname);
}

export async function assertWorkerEgressAllowed(
  target: string | URL | Request,
  options: WorkerEgressGuardOptions = {},
): Promise<void> {
  if (options.allowInternalEgress) return;

  const hostname = getUrlHostname(target);
  if (!hostname) return;

  await assertWorkerHostEgressAllowed(hostname, options);
}

export async function assertWorkerHostEgressAllowed(
  hostname: string,
  options: WorkerEgressGuardOptions = {},
): Promise<void> {
  if (options.allowInternalEgress) return;

  const host = stripIpv6Brackets(hostname.trim().toLowerCase());
  if (isLocalhostName(host) || isInternalEgressIp(host)) {
    throw new WorkerEgressBlockedError(
      `Worker network egress blocked for internal host: ${hostname}`,
    );
  }
  if (isIpLiteral(host)) return;

  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const addresses = await resolveHost(host);
  if (addresses.length === 0) {
    throw new WorkerEgressBlockedError(
      `Worker network egress blocked: unable to resolve host ${hostname}`,
    );
  }

  for (const address of addresses) {
    if (isInternalEgressIp(address)) {
      throw new WorkerEgressBlockedError(
        `Worker network egress blocked for host ${hostname} resolved to internal address ${address}`,
      );
    }
  }
}

function getConnectHostname(options: unknown): string | null {
  if (!isObject(options)) return null;
  const hostname = options.hostname;
  return typeof hostname === "string" ? hostname : null;
}

function getAllowInternalEgress(): boolean {
  return isInternalEgressOverrideEnabled(getHostEnv(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV));
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_EGRESS_REDIRECTS = 20;

/** Dependencies for {@link guardedEgressFetch} (injectable for tests). */
export interface GuardedEgressFetchDeps {
  /** Underlying fetch implementation (defaults to the global `fetch`). */
  fetchImpl?: typeof fetch;
  /** Egress options applied to the initial URL and every redirect hop. */
  options?: WorkerEgressGuardOptions;
}

/** A request body that can be safely replayed across a body-preserving redirect. */
function isReplayableBody(body: BodyInit | null | undefined): boolean {
  return body == null || typeof body === "string" ||
    body instanceof Uint8Array || body instanceof ArrayBuffer ||
    body instanceof URLSearchParams;
}

/**
 * Egress-checked fetch that re-validates EVERY redirect hop.
 *
 * The platform `fetch` follows 3xx redirects transparently, so checking only the
 * initial URL lets a public host redirect to an internal address (loopback,
 * RFC1918, link-local, cloud metadata) that the guard never sees. This forces
 * `redirect: "manual"` on the underlying fetch and re-runs the egress check on
 * each `Location` before following it. The caller's redirect intent is honored:
 * `manual` returns the redirect unfollowed, `error` throws, `follow` (default)
 * follows manually after re-checking. Credential headers are stripped on a
 * cross-origin hop, matching the platform fetch the guard wraps.
 */
export async function guardedEgressFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  deps: GuardedEgressFetchDeps = {},
): Promise<Response> {
  const doFetch = deps.fetchImpl ?? fetch;
  const options = deps.options ?? {};

  const requestedRedirect: RequestRedirect = init?.redirect ??
    (input instanceof Request ? input.redirect : "follow");

  let url = input instanceof Request
    ? input.url
    : input instanceof URL
    ? input.href
    : String(input);
  let method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  let body: BodyInit | undefined;
  if (init?.body != null) {
    body = init.body as BodyInit;
  } else if (input instanceof Request && input.body) {
    body = new Uint8Array(await input.arrayBuffer());
  }

  // Preserve request-level options (notably `signal`, so aborts keep working)
  // that would otherwise be dropped when the caller passes a Request object
  // rather than an init bag, and that must persist across every redirect hop.
  const reqInput = input instanceof Request ? input : undefined;
  const carryInit: RequestInit = {
    signal: init?.signal ?? reqInput?.signal,
    credentials: init?.credentials ?? reqInput?.credentials,
    cache: init?.cache ?? reqInput?.cache,
    mode: init?.mode ?? reqInput?.mode,
    referrer: init?.referrer ?? reqInput?.referrer,
    referrerPolicy: init?.referrerPolicy ?? reqInput?.referrerPolicy,
    keepalive: init?.keepalive ?? reqInput?.keepalive,
  };

  for (let hop = 0;; hop++) {
    await assertWorkerEgressAllowed(url, options);

    const response = await doFetch(url, {
      ...init,
      ...carryInit,
      method,
      headers,
      body,
      redirect: "manual",
    });

    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    if (requestedRedirect === "manual") return response;
    if (requestedRedirect === "error") {
      throw new WorkerEgressBlockedError(
        "Worker egress: unexpected redirect with redirect mode 'error'",
      );
    }
    if (hop >= MAX_EGRESS_REDIRECTS) {
      throw new WorkerEgressBlockedError(
        "Worker network egress blocked: exceeded maximum redirect count",
      );
    }

    const nextUrl = new URL(location, url);
    // Only follow redirects to http(s). The platform fetch treats a redirect to
    // any other scheme as a network error; following e.g. file:// here would let
    // an attacker-controlled redirect turn a network fetch into a local file
    // read, since assertWorkerEgressAllowed no-ops for hostless (non-network)
    // URLs.
    if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
      throw new WorkerEgressBlockedError(
        `Worker network egress blocked: redirect to non-http(s) scheme ${nextUrl.protocol}`,
      );
    }
    // Cross-origin redirect: strip credential-bearing headers, matching the
    // platform fetch this guard replaces, so a redirect target cannot receive
    // the caller's Authorization/Cookie.
    if (nextUrl.origin !== new URL(url).origin) {
      headers.delete("authorization");
      headers.delete("cookie");
      headers.delete("proxy-authorization");
    }
    url = nextUrl.href;

    // Standard fetch redirect method/body rules: 301/302 downgrade POST, while
    // 303 downgrades every method except GET and HEAD. 307/308 always preserve.
    const downgrades =
      ((response.status === 301 || response.status === 302) && method === "POST") ||
      (response.status === 303 && method !== "GET" && method !== "HEAD");
    if (downgrades) {
      method = "GET";
      body = undefined;
      for (
        const header of [
          "content-encoding",
          "content-language",
          "content-length",
          "content-location",
          "content-type",
        ]
      ) {
        headers.delete(header);
      }
    } else if (!isReplayableBody(body)) {
      throw new WorkerEgressBlockedError(
        "Worker network egress blocked: cannot safely follow a body-preserving redirect",
      );
    }
  }
}

export function installWorkerEgressGuard(options: WorkerEgressGuardOptions = {}): void {
  const globalRecord = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  if (globalRecord[guardInstalled]) return;

  const baseOptions = {
    ...options,
    allowInternalEgress: options.allowInternalEgress ?? getAllowInternalEgress(),
  };

  const originalFetch = globalThis.fetch.bind(globalThis);
  const fetchWrapper = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    // guardedEgressFetch checks the initial URL and re-checks every redirect hop,
    // so a public host cannot redirect into an internal address.
    return await guardedEgressFetch(input, init, {
      fetchImpl: originalFetch,
      options: baseOptions,
    });
  };
  Object.defineProperty(fetchWrapper, guardedFetch, { value: true });
  globalThis.fetch = fetchWrapper as typeof fetch;

  if (typeof Deno.connect === "function") {
    const originalConnect = Deno.connect.bind(Deno);
    const connectWrapper = async (
      options: Parameters<typeof Deno.connect>[0],
    ): ReturnType<typeof Deno.connect> => {
      const hostname = getConnectHostname(options);
      if (hostname) await assertWorkerHostEgressAllowed(hostname, baseOptions);
      return await originalConnect(options);
    };
    Object.defineProperty(connectWrapper, guardedConnect, { value: true });
    Deno.connect = connectWrapper as typeof Deno.connect;
  }

  if (typeof Deno.connectTls === "function") {
    const originalConnectTls = Deno.connectTls.bind(Deno);
    const connectTlsWrapper = async (
      options: Parameters<typeof Deno.connectTls>[0],
    ): ReturnType<typeof Deno.connectTls> => {
      const hostname = getConnectHostname(options);
      if (hostname) await assertWorkerHostEgressAllowed(hostname, baseOptions);
      return await originalConnectTls(options);
    };
    Object.defineProperty(connectTlsWrapper, guardedConnectTls, { value: true });
    Deno.connectTls = connectTlsWrapper as typeof Deno.connectTls;
  }

  globalRecord[guardInstalled] = true;
}
