/**
 * Worker network egress guard.
 *
 * Project workers need outbound network access for public API calls, but user
 * code must not reach host-internal networks or cloud metadata endpoints.
 *
 * @module security/sandbox/worker-egress-guard
 */

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

function isPrivateIpv4(octets: number[]): boolean {
  const [a = -1, b = -1] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  );
}

function isInternalIpv6(value: string): boolean {
  const normalized = stripIpv6Zone(stripIpv6Brackets(value)).toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;

  const mappedIpv4 = normalized.match(/(?:::ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4?.[1]) {
    const octets = parseIpv4(mappedIpv4[1]);
    return octets !== null && isPrivateIpv4(octets);
  }

  const firstHextetText = normalized.split(":", 1)[0] ?? "";
  if (!/^[0-9a-f]{1,4}$/.test(firstHextetText)) return false;
  const firstHextet = Number.parseInt(firstHextetText, 16);

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
  return parseIpv4(host) !== null || host.includes(":");
}

function isLocalhostName(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost");
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const results: string[] = [];
  const resolver = Deno.resolveDns;

  for (const recordType of ["A", "AAAA"] as const) {
    try {
      results.push(...await resolver(hostname, recordType));
    } catch {
      // A host may legitimately have only one address family.
    }
  }

  return results;
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
  try {
    return isInternalEgressOverrideEnabled(Deno.env.get(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV));
  } catch {
    return false;
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
    await assertWorkerEgressAllowed(input, baseOptions);
    return await originalFetch(input, init);
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
