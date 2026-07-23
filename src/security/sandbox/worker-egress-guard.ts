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
import { getDenoRuntime } from "#veryfront/platform/compat/runtime.ts";

export const WORKER_INTERNAL_EGRESS_OVERRIDE_ENV = "VERYFRONT_WORKER_ALLOW_INTERNAL_EGRESS";

export class WorkerEgressBlockedError extends Error {
  override name = "WorkerEgressBlockedError";
}

export type ResolveWorkerHost = (hostname: string) => Promise<string[]>;

export interface WorkerEgressSocksProxyConfig {
  hostname: string;
  port: number;
  username: string;
  password: string;
}

export interface WorkerEgressHttpBrokerConfig {
  url: string;
  token: string;
}

export interface WorkerEgressGuardOptions {
  allowInternalEgress?: boolean;
  resolveHost?: ResolveWorkerHost;
  socksProxy?: WorkerEgressSocksProxyConfig;
  httpBroker?: WorkerEgressHttpBrokerConfig;
}

export type WorkerEgressTcpConnect = (options: Deno.ConnectOptions) => Promise<Deno.TcpConn>;
export type WorkerEgressTcpListen = (options: Deno.ListenOptions) => Deno.TcpListener;
export type WorkerEgressStartTls = (
  conn: Deno.TcpConn,
  options?: Deno.StartTlsOptions,
) => Promise<Deno.TlsConn>;
export type WorkerEgressCreateHttpClient = (
  options: Deno.CreateHttpClientOptions | (Deno.CreateHttpClientOptions & Deno.TlsCertifiedKeyPem),
) => Deno.HttpClient;

export interface PinnedEgressRuntime {
  connect: WorkerEgressTcpConnect;
  listen: WorkerEgressTcpListen;
  startTls: WorkerEgressStartTls;
  createHttpClient: WorkerEgressCreateHttpClient;
}

const guardInstalled = Symbol.for("veryfront.workerEgressGuardInstalled");
const guardedFetch = Symbol.for("veryfront.workerEgressGuard.fetch");
const guardedConnect = Symbol.for("veryfront.workerEgressGuard.connect");
const guardedConnectTls = Symbol.for("veryfront.workerEgressGuard.connectTls");

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

export function isInternalEgressOverrideEnabled(value: string | undefined): boolean {
  return value === "1";
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
  const [a = -1, b = -1, c = -1] = octets;
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
    // IETF protocol, documentation, and deprecated relay ranges.
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    // Unspecified, multicast, reserved, and limited broadcast ranges.
    a === 0 ||
    a >= 224
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

  // Block non-global and address-transition ranges. Several transition
  // mechanisms embed an IPv4 destination and can otherwise smuggle a private
  // address through an IPv6-looking literal.
  const isIpv4Compatible = hextets.slice(0, 6).every((hextet) => hextet === 0);
  const isNat64 = firstHextet === 0x0064 &&
    ((hextets[1] === 0xff9b && hextets[2] === 0 && hextets[3] === 0) ||
      hextets[1] === 0xff9b && hextets[2] === 1);
  const isDiscardOnly = firstHextet === 0x0100 &&
    hextets.slice(1, 4).every((hextet) => hextet === 0);
  // The IETF Protocol Assignments aggregate 2001::/23 is not globally reachable.
  const isIetfProtocolAssignment = firstHextet === 0x2001 &&
    ((hextets[1] ?? 0) & 0xfe00) === 0;
  const isDocumentation = firstHextet === 0x2001 && hextets[1] === 0x0db8;
  const isDocumentationV2 = firstHextet === 0x3fff &&
    ((hextets[1] ?? 0) & 0xf000) === 0;
  const isSixToFour = firstHextet === 0x2002;
  const isSiteLocal = (firstHextet & 0xffc0) === 0xfec0;
  const isMulticast = (firstHextet & 0xff00) === 0xff00;
  const isGlobalUnicast = (firstHextet & 0xe000) === 0x2000;

  // fe80::/10 link-local, fc00::/7 unique local.
  return isIpv4Compatible || isNat64 || isDiscardOnly || isIetfProtocolAssignment ||
    isDocumentation || isDocumentationV2 || isSixToFour || isSiteLocal || isMulticast ||
    (firstHextet & 0xffc0) === 0xfe80 || (firstHextet & 0xfe00) === 0xfc00 ||
    !isGlobalUnicast;
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
  const hostname = getUrlHostname(target);
  if (!hostname) return;

  await resolveWorkerHostEgressAddresses(hostname, options);
}

export async function assertWorkerHostEgressAllowed(
  hostname: string,
  options: WorkerEgressGuardOptions = {},
): Promise<void> {
  await resolveWorkerHostEgressAddresses(hostname, options);
}

async function resolveWorkerHostEgressAddresses(
  hostname: string,
  options: WorkerEgressGuardOptions,
  signal?: AbortSignal,
): Promise<string[]> {
  const allowInternalEgress = options.allowInternalEgress === true;

  const host = stripIpv6Brackets(hostname.trim().toLowerCase());
  if (!allowInternalEgress && (isLocalhostName(host) || isInternalEgressIp(host))) {
    throw new WorkerEgressBlockedError(
      `Worker network egress blocked for internal host: ${hostname}`,
    );
  }
  if (isIpLiteral(host)) return [host];

  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const addresses = await waitForOperation(resolveHost(host), signal);
  if (addresses.length === 0) {
    throw new WorkerEgressBlockedError(
      `Worker network egress blocked: unable to resolve host ${hostname}`,
    );
  }

  const normalizedAddresses: string[] = [];
  for (const address of addresses) {
    const normalizedAddress = stripIpv6Zone(stripIpv6Brackets(address.trim().toLowerCase()));
    if (!isIpLiteral(normalizedAddress)) {
      throw new WorkerEgressBlockedError(
        `Worker network egress blocked: resolver returned an invalid address for host ${hostname}`,
      );
    }
    if (!allowInternalEgress && isInternalEgressIp(normalizedAddress)) {
      throw new WorkerEgressBlockedError(
        `Worker network egress blocked for host: ${hostname}`,
      );
    }
    if (!normalizedAddresses.includes(normalizedAddress)) {
      normalizedAddresses.push(normalizedAddress);
    }
  }
  return normalizedAddresses;
}

function getConnectHostname(options: unknown): string | null {
  if (!isObject(options)) return null;
  const transport = options.transport;
  if (transport !== undefined && transport !== "tcp") return null;
  const hostname = options.hostname;
  return typeof hostname === "string" ? hostname : "127.0.0.1";
}

function getAllowInternalEgress(): boolean {
  return isInternalEgressOverrideEnabled(getHostEnv(WORKER_INTERNAL_EGRESS_OVERRIDE_ENV));
}

function getPinnedEgressRuntime(
  override?: Partial<PinnedEgressRuntime>,
): PinnedEgressRuntime {
  const deno = getDenoRuntime();
  const connect = override?.connect ??
    deno?.connect?.bind(deno) as WorkerEgressTcpConnect | undefined;
  const listen = override?.listen ?? deno?.listen?.bind(deno) as WorkerEgressTcpListen | undefined;
  const startTls = override?.startTls ??
    deno?.startTls?.bind(deno) as WorkerEgressStartTls | undefined;
  const createHttpClient = override?.createHttpClient ??
    deno?.createHttpClient?.bind(deno) as WorkerEgressCreateHttpClient | undefined;

  if (!connect || !listen || !startTls || !createHttpClient) {
    throw new WorkerEgressBlockedError(
      "Worker network egress blocked: a DNS-pinned transport is unavailable",
    );
  }
  return { connect, listen, startTls, createHttpClient };
}

function safeClose(connection: { close(): void }): void {
  try {
    connection.close();
  } catch {
    // The connection may already be closed by its peer.
  }
}

async function readExactly(connection: Deno.Conn, length: number): Promise<Uint8Array> {
  const result = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const read = await connection.read(result.subarray(offset));
    if (read === null) throw new Error("SOCKS proxy connection closed during handshake");
    offset += read;
  }
  return result;
}

async function writeAll(connection: Deno.Conn, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await connection.write(bytes.subarray(offset));
    if (written === 0) throw new Error("SOCKS proxy connection stopped accepting data");
    offset += written;
  }
}

function waitForOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function relayTcpConnections(
  left: Deno.Conn,
  right: Deno.Conn,
  shutdownSignal: AbortSignal,
): Promise<void> {
  const failureController = new AbortController();
  const signal = AbortSignal.any([shutdownSignal, failureController.signal]);
  const abortConnections = () => {
    safeClose(left);
    safeClose(right);
  };
  if (signal.aborted) abortConnections();
  else signal.addEventListener("abort", abortConnections, { once: true });

  const relay = async (source: Deno.Conn, destination: Deno.Conn): Promise<void> => {
    try {
      const buffer = new Uint8Array(16 * 1024);
      while (true) {
        const read = await source.read(buffer);
        if (read === null) {
          await destination.closeWrite();
          return;
        }
        await writeAll(destination, buffer.subarray(0, read));
      }
    } catch (error) {
      if (!signal.aborted) failureController.abort(error);
      throw error;
    }
  };

  const results = await Promise.allSettled([
    relay(left, right),
    relay(right, left),
  ]);
  signal.removeEventListener("abort", abortConnections);
  const failure = results.find((result): result is PromiseRejectedResult =>
    result.status === "rejected"
  );
  if (failure && !shutdownSignal.aborted) throw failure.reason;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

function hostsMatch(left: string, right: string): boolean {
  const leftV4 = parseIpv4(stripIpv6Brackets(left));
  const rightV4 = parseIpv4(stripIpv6Brackets(right));
  if (leftV4 || rightV4) {
    return leftV4 !== null && rightV4 !== null &&
      leftV4.every((value, index) => value === rightV4[index]);
  }

  const leftV6 = parseIpv6(left);
  const rightV6 = parseIpv6(right);
  if (leftV6 || rightV6) {
    return leftV6 !== null && rightV6 !== null &&
      leftV6.every((value, index) => value === rightV6[index]);
  }

  const normalizeName = (value: string) => value.trim().toLowerCase().replace(/\.$/, "");
  return normalizeName(left) === normalizeName(right);
}

async function readSocksTarget(connection: Deno.Conn): Promise<{ hostname: string; port: number }> {
  const request = await readExactly(connection, 4);
  if (request[0] !== 0x05 || request[1] !== 0x01 || request[2] !== 0x00) {
    throw new Error("SOCKS proxy received an unsupported request");
  }

  let hostname: string;
  switch (request[3]) {
    case 0x01: {
      hostname = [...await readExactly(connection, 4)].join(".");
      break;
    }
    case 0x03: {
      const [length = 0] = await readExactly(connection, 1);
      if (length === 0) throw new Error("SOCKS proxy received an empty hostname");
      hostname = new TextDecoder("utf-8", { fatal: true }).decode(
        await readExactly(connection, length),
      );
      break;
    }
    case 0x04: {
      const address = await readExactly(connection, 16);
      const hextets: string[] = [];
      for (let index = 0; index < address.length; index += 2) {
        hextets.push((((address[index] ?? 0) << 8) | (address[index + 1] ?? 0)).toString(16));
      }
      hostname = hextets.join(":");
      break;
    }
    default:
      throw new Error("SOCKS proxy received an unsupported address type");
  }

  const portBytes = await readExactly(connection, 2);
  return { hostname, port: ((portBytes[0] ?? 0) << 8) | (portBytes[1] ?? 0) };
}

async function authenticateSocksClient(
  connection: Deno.Conn,
  username: Uint8Array,
  password: Uint8Array,
): Promise<boolean> {
  const greeting = await readExactly(connection, 2);
  if (greeting[0] !== 0x05) return false;
  const methods = await readExactly(connection, greeting[1] ?? 0);
  if (!methods.includes(0x02)) {
    await writeAll(connection, new Uint8Array([0x05, 0xff]));
    return false;
  }
  await writeAll(connection, new Uint8Array([0x05, 0x02]));

  const authHeader = await readExactly(connection, 2);
  if (authHeader[0] !== 0x01) return false;
  const receivedUsername = await readExactly(connection, authHeader[1] ?? 0);
  const [passwordLength = 0] = await readExactly(connection, 1);
  const receivedPassword = await readExactly(connection, passwordLength);
  const authenticated = constantTimeEqual(receivedUsername, username) &&
    constantTimeEqual(receivedPassword, password);
  await writeAll(connection, new Uint8Array([0x01, authenticated ? 0x00 : 0x01]));
  return authenticated;
}

function encodeSocksTarget(hostname: string, port: number): Uint8Array {
  const normalizedHostname = stripIpv6Brackets(hostname);
  const ipv4 = parseIpv4(normalizedHostname);
  let address: Uint8Array;
  let addressType: number;
  if (ipv4) {
    addressType = 0x01;
    address = new Uint8Array(ipv4);
  } else {
    const ipv6 = parseIpv6(normalizedHostname);
    if (ipv6) {
      addressType = 0x04;
      address = new Uint8Array(16);
      for (let index = 0; index < ipv6.length; index++) {
        const hextet = ipv6[index] ?? 0;
        address[index * 2] = hextet >> 8;
        address[index * 2 + 1] = hextet & 0xff;
      }
    } else {
      addressType = 0x03;
      const encodedHostname = new TextEncoder().encode(normalizedHostname);
      if (encodedHostname.length === 0 || encodedHostname.length > 255) {
        throw new WorkerEgressBlockedError(
          "Worker network egress blocked: hostname is too long for the proxy transport",
        );
      }
      address = new Uint8Array(encodedHostname.length + 1);
      address[0] = encodedHostname.length;
      address.set(encodedHostname, 1);
    }
  }

  const request = new Uint8Array(3 + 1 + address.length + 2);
  request.set([0x05, 0x01, 0x00, addressType], 0);
  request.set(address, 4);
  request[request.length - 2] = port >> 8;
  request[request.length - 1] = port & 0xff;
  return request;
}

async function discardSocksAddress(connection: Deno.Conn, addressType: number): Promise<void> {
  switch (addressType) {
    case 0x01:
      await readExactly(connection, 4);
      return;
    case 0x03: {
      const [length = 0] = await readExactly(connection, 1);
      await readExactly(connection, length);
      return;
    }
    case 0x04:
      await readExactly(connection, 16);
      return;
    default:
      throw new Error("SOCKS proxy returned an unsupported address type");
  }
}

async function connectThroughWorkerEgressProxy(
  hostname: string,
  port: number,
  proxy: WorkerEgressSocksProxyConfig,
  connect: WorkerEgressTcpConnect,
  signal?: AbortSignal,
): Promise<Deno.TcpConn> {
  const connection = await connect({
    hostname: proxy.hostname,
    port: proxy.port,
    transport: "tcp",
    signal,
  });
  const abortConnection = () => safeClose(connection);
  signal?.addEventListener("abort", abortConnection, { once: true });
  try {
    await writeAll(connection, new Uint8Array([0x05, 0x01, 0x02]));
    const method = await readExactly(connection, 2);
    if (method[0] !== 0x05 || method[1] !== 0x02) {
      throw new Error("Worker egress proxy rejected authentication");
    }

    const username = new TextEncoder().encode(proxy.username);
    const password = new TextEncoder().encode(proxy.password);
    if (username.length > 255 || password.length > 255) {
      throw new Error("Worker egress proxy credentials are invalid");
    }
    const auth = new Uint8Array(3 + username.length + password.length);
    auth.set([0x01, username.length], 0);
    auth.set(username, 2);
    auth[username.length + 2] = password.length;
    auth.set(password, username.length + 3);
    await writeAll(connection, auth);
    const authResponse = await readExactly(connection, 2);
    if (authResponse[0] !== 0x01 || authResponse[1] !== 0x00) {
      throw new Error("Worker egress proxy authentication failed");
    }

    await writeAll(connection, encodeSocksTarget(hostname, port));
    const response = await readExactly(connection, 4);
    if (response[0] !== 0x05 || response[1] !== 0x00 || response[2] !== 0x00) {
      throw new WorkerEgressBlockedError(
        `Worker network egress blocked for host: ${hostname}`,
      );
    }
    await discardSocksAddress(connection, response[3] ?? 0);
    await readExactly(connection, 2);
    signal?.removeEventListener("abort", abortConnection);
    return connection;
  } catch (error) {
    signal?.removeEventListener("abort", abortConnection);
    safeClose(connection);
    throw error;
  }
}

async function connectFirstAddress(
  addresses: readonly string[],
  port: number,
  connect: WorkerEgressTcpConnect,
  signal: AbortSignal,
): Promise<Deno.TcpConn> {
  let lastError: unknown;
  for (const hostname of addresses) {
    try {
      const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      return await connect({ hostname, port, transport: "tcp", signal: attemptSignal });
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      lastError = error;
    }
  }
  throw lastError ?? new Error("No validated address was available");
}

interface PinnedSocksTunnel {
  client: Deno.HttpClient;
  abort(): void;
  closeListener(): void;
}

function randomCredential(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function startPinnedSocksTunnel(
  expectedHostname: string,
  addresses: readonly string[],
  port: number,
  runtime: PinnedEgressRuntime,
): PinnedSocksTunnel {
  const listener = runtime.listen({ hostname: "127.0.0.1", port: 0 });
  const listenerAddress = listener.addr;
  if (listenerAddress.transport !== "tcp") {
    safeClose(listener);
    throw new WorkerEgressBlockedError(
      "Worker network egress blocked: unable to create a pinned transport",
    );
  }

  const usernameText = `vf-${randomCredential()}`;
  const passwordText = randomCredential();
  const encoder = new TextEncoder();
  const username = encoder.encode(usernameText);
  const password = encoder.encode(passwordText);
  const controller = new AbortController();
  const connections = new Set<Deno.Conn>();
  let accepting = true;
  let claimed = false;

  const closeListener = () => {
    if (!accepting) return;
    accepting = false;
    safeClose(listener);
  };

  const abort = () => {
    closeListener();
    controller.abort(new Error("Pinned egress tunnel closed"));
    for (const connection of connections) safeClose(connection);
    connections.clear();
  };

  const handleConnection = async (downstream: Deno.TcpConn): Promise<void> => {
    connections.add(downstream);
    const handshakeController = new AbortController();
    let handshakeExpired = false;
    const handshakeTimeout = setTimeout(() => {
      handshakeExpired = true;
      handshakeController.abort(new Error("SOCKS proxy handshake timed out"));
      safeClose(downstream);
    }, 10_000);
    let upstream: Deno.TcpConn | undefined;
    let responseStarted = false;
    try {
      const authenticated = await authenticateSocksClient(downstream, username, password);
      if (!authenticated || claimed) return;

      const target = await readSocksTarget(downstream);
      if (target.port !== port || !hostsMatch(target.hostname, expectedHostname)) {
        await writeAll(
          downstream,
          new Uint8Array([0x05, 0x02, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
        );
        return;
      }

      claimed = true;
      closeListener();
      clearTimeout(handshakeTimeout);
      if (handshakeExpired) return;
      upstream = await connectFirstAddress(
        addresses,
        port,
        runtime.connect,
        AbortSignal.any([controller.signal, handshakeController.signal]),
      );
      connections.add(upstream);
      responseStarted = true;
      await writeAll(
        downstream,
        new Uint8Array([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );

      await relayTcpConnections(downstream, upstream, controller.signal);
    } catch {
      if (!responseStarted) {
        await writeAll(
          downstream,
          new Uint8Array([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
        ).catch(() => undefined);
      }
    } finally {
      clearTimeout(handshakeTimeout);
      safeClose(downstream);
      connections.delete(downstream);
      if (upstream) {
        safeClose(upstream);
        connections.delete(upstream);
      }
    }
  };

  const acceptLoop = async () => {
    while (accepting && !claimed) {
      try {
        const connection = await listener.accept();
        void handleConnection(connection);
      } catch {
        if (accepting) abort();
        return;
      }
    }
  };
  void acceptLoop();

  let client: Deno.HttpClient;
  try {
    client = runtime.createHttpClient({
      proxy: {
        transport: "socks5",
        url: `socks5h://127.0.0.1:${listenerAddress.port}`,
        basicAuth: { username: usernameText, password: passwordText },
      },
    });
  } catch (error) {
    abort();
    throw error;
  }

  return { client, abort, closeListener };
}

export interface WorkerEgressSocksProxy {
  config: WorkerEgressSocksProxyConfig;
  close(): void;
}

export function startWorkerEgressSocksProxy(
  options: WorkerEgressGuardOptions = {},
  runtimeOverride?: Partial<PinnedEgressRuntime>,
): WorkerEgressSocksProxy {
  const runtime = getPinnedEgressRuntime(runtimeOverride);
  const listener = runtime.listen({ hostname: "127.0.0.1", port: 0 });
  const address = listener.addr;
  if (address.transport !== "tcp") {
    safeClose(listener);
    throw new Error("Worker egress proxy requires a TCP listener");
  }

  const config: WorkerEgressSocksProxyConfig = {
    hostname: "127.0.0.1",
    port: address.port,
    username: `vf-${randomCredential()}`,
    password: randomCredential(),
  };
  const encoder = new TextEncoder();
  const username = encoder.encode(config.username);
  const password = encoder.encode(config.password);
  const controller = new AbortController();
  const connections = new Set<Deno.Conn>();
  let open = true;

  const close = () => {
    if (!open) return;
    open = false;
    controller.abort(new Error("Worker egress proxy closed"));
    safeClose(listener);
    for (const connection of connections) safeClose(connection);
    connections.clear();
  };

  const handleConnection = async (downstream: Deno.TcpConn): Promise<void> => {
    connections.add(downstream);
    const handshakeController = new AbortController();
    let handshakeExpired = false;
    const handshakeTimeout = setTimeout(() => {
      handshakeExpired = true;
      handshakeController.abort(new Error("SOCKS proxy handshake timed out"));
      safeClose(downstream);
    }, 10_000);
    let upstream: Deno.TcpConn | undefined;
    let responseStarted = false;
    try {
      if (!await authenticateSocksClient(downstream, username, password)) return;
      const target = await readSocksTarget(downstream);
      const handshakeSignal = AbortSignal.any([
        controller.signal,
        handshakeController.signal,
      ]);
      const addresses = await resolveWorkerHostEgressAddresses(
        target.hostname,
        options,
        handshakeSignal,
      );
      if (handshakeExpired) return;
      upstream = await connectFirstAddress(
        addresses,
        target.port,
        runtime.connect,
        handshakeSignal,
      );
      connections.add(upstream);
      clearTimeout(handshakeTimeout);
      responseStarted = true;
      await writeAll(
        downstream,
        new Uint8Array([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );

      await relayTcpConnections(downstream, upstream, controller.signal);
    } catch {
      if (!responseStarted) {
        await writeAll(
          downstream,
          new Uint8Array([0x05, 0x02, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
        ).catch(() => undefined);
      }
    } finally {
      clearTimeout(handshakeTimeout);
      safeClose(downstream);
      connections.delete(downstream);
      if (upstream) {
        safeClose(upstream);
        connections.delete(upstream);
      }
    }
  };

  const acceptLoop = async () => {
    while (open) {
      try {
        const connection = await listener.accept();
        void handleConnection(connection);
      } catch {
        if (open) close();
      }
    }
  };
  void acceptLoop();

  return { config, close };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_EGRESS_REDIRECTS = 20;
const BROKER_AUTH_HEADER = "x-veryfront-egress-auth";
const BROKER_TARGET_HEADER = "x-veryfront-egress-target";
const BROKER_ERROR_HEADER = "x-veryfront-egress-error";
const BROKER_CONTENT_ENCODING_HEADER = "x-veryfront-egress-content-encoding";
const BROKER_CONTENT_LENGTH_HEADER = "x-veryfront-egress-content-length";

const HOP_BY_HOP_HEADERS = [
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const;

function stripHopByHopHeaders(headers: Headers): void {
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
}

function createSocksHttpClient(
  config: WorkerEgressSocksProxyConfig,
  createHttpClient: WorkerEgressCreateHttpClient,
): Deno.HttpClient {
  return createHttpClient({
    proxy: {
      transport: "socks5",
      url: `socks5h://${config.hostname}:${config.port}`,
      basicAuth: { username: config.username, password: config.password },
    },
  });
}

async function fetchThroughHttpBroker(
  fetchImpl: typeof fetch,
  broker: WorkerEgressHttpBrokerConfig,
  targetUrl: string,
  init: RequestInit,
): Promise<Response> {
  const headers = new Headers(init.headers);
  stripHopByHopHeaders(headers);
  headers.delete("content-length");
  headers.set(BROKER_AUTH_HEADER, broker.token);
  headers.set(BROKER_TARGET_HEADER, targetUrl);

  const brokerInit = {
    ...init,
    headers,
    redirect: "manual",
  } as RequestInit & Record<PropertyKey, unknown>;
  delete brokerInit.client;
  const brokerResponse = await fetchImpl(broker.url, brokerInit);
  if (brokerResponse.headers.get(BROKER_ERROR_HEADER) === "1") {
    let message = "Worker network egress failed";
    try {
      const payload = await brokerResponse.json() as { message?: unknown };
      if (typeof payload.message === "string") message = payload.message;
    } catch {
      // Keep the stable fallback when the broker response is malformed.
    }
    throw new WorkerEgressBlockedError(message);
  }

  const responseHeaders = new Headers(brokerResponse.headers);
  const contentEncoding = responseHeaders.get(BROKER_CONTENT_ENCODING_HEADER);
  const contentLength = responseHeaders.get(BROKER_CONTENT_LENGTH_HEADER);
  responseHeaders.delete(BROKER_ERROR_HEADER);
  responseHeaders.delete(BROKER_CONTENT_ENCODING_HEADER);
  responseHeaders.delete(BROKER_CONTENT_LENGTH_HEADER);
  if (contentEncoding !== null) responseHeaders.set("content-encoding", contentEncoding);
  if (contentLength !== null) responseHeaders.set("content-length", contentLength);

  const response = new Response(brokerResponse.body, {
    status: brokerResponse.status,
    statusText: brokerResponse.statusText,
    headers: responseHeaders,
  });
  Object.defineProperties(response, {
    url: { configurable: true, enumerable: true, value: targetUrl },
    redirected: { configurable: true, enumerable: true, value: false },
  });
  return response;
}

/** Dependencies for {@link guardedEgressFetch} (injectable for tests). */
export interface GuardedEgressFetchDeps {
  /** Underlying fetch implementation (defaults to the global `fetch`). */
  fetchImpl?: typeof fetch;
  /** Egress options applied to the initial URL and every redirect hop. */
  options?: WorkerEgressGuardOptions;
  /** Captured runtime primitives used to establish the DNS-pinned tunnel. */
  runtime?: Partial<PinnedEgressRuntime>;
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
  let resolvedRuntime: PinnedEgressRuntime | undefined;
  const getRuntime = () => resolvedRuntime ??= getPinnedEgressRuntime(deps.runtime);
  let didRedirect = false;

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
    const parsedUrl = new URL(url);
    const hostname = getUrlHostname(parsedUrl);
    let tunnel: PinnedSocksTunnel | undefined;
    let client: Deno.HttpClient | undefined;
    let response: Response;
    const isNetworkRequest = hostname !== null &&
      (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:");
    const requestInit: RequestInit = {
      ...init,
      ...carryInit,
      method,
      headers,
      body,
      redirect: "manual",
    };

    if (options.httpBroker && isNetworkRequest) {
      response = await fetchThroughHttpBroker(doFetch, options.httpBroker, url, requestInit);
    } else {
      if (hostname && isNetworkRequest) {
        if (options.socksProxy) {
          client = createSocksHttpClient(options.socksProxy, getRuntime().createHttpClient);
        } else {
          const addresses = await resolveWorkerHostEgressAddresses(
            hostname,
            options,
            requestInit.signal ?? undefined,
          );
          const port = parsedUrl.port
            ? Number.parseInt(parsedUrl.port, 10)
            : parsedUrl.protocol === "https:"
            ? 443
            : 80;
          tunnel = startPinnedSocksTunnel(hostname, addresses, port, getRuntime());
          client = tunnel.client;
        }
      }

      try {
        response = await doFetch(url, {
          ...requestInit,
          ...(client ? { client } : {}),
        });
      } catch (error) {
        tunnel?.abort();
        throw error;
      } finally {
        client?.close();
        tunnel?.closeListener();
      }
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      Object.defineProperties(response, {
        url: { configurable: true, enumerable: true, value: url },
        redirected: { configurable: true, enumerable: true, value: didRedirect },
      });
      return response;
    }
    const location = response.headers.get("location");
    if (!location) return response;
    if (requestedRedirect === "manual") return response;
    if (requestedRedirect === "error") {
      await response.body?.cancel().catch(() => undefined);
      throw new WorkerEgressBlockedError(
        "Worker egress: unexpected redirect with redirect mode 'error'",
      );
    }
    if (hop >= MAX_EGRESS_REDIRECTS) {
      await response.body?.cancel().catch(() => undefined);
      throw new WorkerEgressBlockedError(
        "Worker network egress blocked: exceeded maximum redirect count",
      );
    }

    await response.body?.cancel().catch(() => undefined);

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
    didRedirect = true;

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

export interface WorkerEgressBrokerConfig {
  socksProxy: WorkerEgressSocksProxyConfig;
  httpBroker: WorkerEgressHttpBrokerConfig;
  netAllowlist: string[];
}

export interface WorkerEgressBroker {
  config: WorkerEgressBrokerConfig;
  close(): void;
}

export function startWorkerEgressBroker(
  options: WorkerEgressGuardOptions = {},
  runtimeOverride?: Partial<PinnedEgressRuntime>,
): WorkerEgressBroker {
  const runtime = getPinnedEgressRuntime(runtimeOverride);
  const deno = getDenoRuntime();
  if (!deno?.serve) {
    throw new Error("Worker egress broker requires the Deno HTTP server");
  }

  const socks = startWorkerEgressSocksProxy(options, runtime);
  const token = randomCredential();
  const tokenBytes = new TextEncoder().encode(token);
  const controller = new AbortController();
  const fetchImpl = globalThis.fetch.bind(globalThis);

  const handler = async (request: Request): Promise<Response> => {
    const receivedToken = new TextEncoder().encode(request.headers.get(BROKER_AUTH_HEADER) ?? "");
    if (!constantTimeEqual(receivedToken, tokenBytes)) {
      return Response.json(
        { message: "Worker network egress broker authentication failed" },
        { status: 403, headers: { [BROKER_ERROR_HEADER]: "1" } },
      );
    }

    const target = request.headers.get(BROKER_TARGET_HEADER);
    let targetUrl: URL;
    try {
      targetUrl = new URL(target ?? "");
      if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") throw new Error();
    } catch {
      return Response.json(
        { message: "Worker network egress blocked: invalid broker target" },
        { status: 400, headers: { [BROKER_ERROR_HEADER]: "1" } },
      );
    }

    const headers = new Headers(request.headers);
    headers.delete(BROKER_AUTH_HEADER);
    headers.delete(BROKER_TARGET_HEADER);
    headers.delete(BROKER_ERROR_HEADER);
    headers.delete(BROKER_CONTENT_ENCODING_HEADER);
    headers.delete(BROKER_CONTENT_LENGTH_HEADER);
    headers.delete("content-length");
    stripHopByHopHeaders(headers);

    try {
      const response = await guardedEgressFetch(
        targetUrl,
        {
          method: request.method,
          headers,
          body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
          redirect: "manual",
          signal: request.signal,
        },
        {
          fetchImpl,
          options: {
            ...options,
            httpBroker: undefined,
            socksProxy: socks.config,
          },
          runtime,
        },
      );

      const responseHeaders = new Headers(response.headers);
      const contentEncoding = responseHeaders.get("content-encoding");
      const contentLength = responseHeaders.get("content-length");
      responseHeaders.delete(BROKER_AUTH_HEADER);
      responseHeaders.delete(BROKER_TARGET_HEADER);
      responseHeaders.delete(BROKER_ERROR_HEADER);
      responseHeaders.delete(BROKER_CONTENT_ENCODING_HEADER);
      responseHeaders.delete(BROKER_CONTENT_LENGTH_HEADER);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      stripHopByHopHeaders(responseHeaders);
      if (contentEncoding !== null) {
        responseHeaders.set(BROKER_CONTENT_ENCODING_HEADER, contentEncoding);
      }
      if (contentLength !== null) {
        responseHeaders.set(BROKER_CONTENT_LENGTH_HEADER, contentLength);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      const message = error instanceof WorkerEgressBlockedError
        ? error.message
        : "Worker network egress blocked or failed";
      return Response.json(
        { message },
        { status: 502, headers: { [BROKER_ERROR_HEADER]: "1" } },
      );
    }
  };

  let server: Deno.HttpServer<Deno.NetAddr>;
  try {
    server = deno.serve(
      {
        hostname: "127.0.0.1",
        port: 0,
        signal: controller.signal,
        onListen() {},
      },
      handler,
    );
  } catch (error) {
    socks.close();
    throw error;
  }
  const address = server.addr;
  if (address.transport !== "tcp") {
    controller.abort();
    socks.close();
    throw new Error("Worker egress broker requires a TCP HTTP listener");
  }

  const httpBroker: WorkerEgressHttpBrokerConfig = {
    url: `http://127.0.0.1:${address.port}/fetch`,
    token,
  };
  const close = () => {
    controller.abort();
    socks.close();
  };
  return {
    config: {
      socksProxy: socks.config,
      httpBroker,
      netAllowlist: [
        `${socks.config.hostname}:${socks.config.port}`,
        `127.0.0.1:${address.port}`,
      ],
    },
    close,
  };
}

export async function guardedWorkerConnect(
  connectOptions: Deno.ConnectOptions,
  options: WorkerEgressGuardOptions = {},
  runtimeOverride?: Partial<PinnedEgressRuntime>,
): Promise<Deno.TcpConn> {
  const runtime = getPinnedEgressRuntime(runtimeOverride);
  const hostname = connectOptions.hostname ?? "127.0.0.1";
  if (options.socksProxy) {
    return await connectThroughWorkerEgressProxy(
      hostname,
      connectOptions.port,
      options.socksProxy,
      runtime.connect,
      connectOptions.signal,
    );
  }

  const signal = connectOptions.signal ?? new AbortController().signal;
  const addresses = await resolveWorkerHostEgressAddresses(hostname, options, signal);
  return await connectFirstAddress(
    addresses,
    connectOptions.port,
    runtime.connect,
    signal,
  );
}

export async function guardedWorkerConnectTls(
  connectOptions:
    & (Deno.ConnectTlsOptions | (Deno.ConnectTlsOptions & Deno.TlsCertifiedKeyPem))
    & { signal?: AbortSignal },
  options: WorkerEgressGuardOptions = {},
  runtimeOverride?: Partial<PinnedEgressRuntime>,
): Promise<Deno.TlsConn> {
  if ("cert" in connectOptions || "key" in connectOptions) {
    throw new WorkerEgressBlockedError(
      "Worker network egress blocked: client certificates are unavailable on the guarded raw TLS transport",
    );
  }

  const runtime = getPinnedEgressRuntime(runtimeOverride);
  const hostname = connectOptions.hostname ?? "127.0.0.1";
  const signal = connectOptions.signal ?? new AbortController().signal;
  let connection: Deno.TcpConn;
  if (options.socksProxy) {
    connection = await connectThroughWorkerEgressProxy(
      hostname,
      connectOptions.port,
      options.socksProxy,
      runtime.connect,
      signal,
    );
  } else {
    const addresses = await resolveWorkerHostEgressAddresses(hostname, options, signal);
    connection = await connectFirstAddress(
      addresses,
      connectOptions.port,
      runtime.connect,
      signal,
    );
  }

  try {
    return await waitForOperation(
      runtime.startTls(connection, {
        hostname,
        caCerts: connectOptions.caCerts,
        alpnProtocols: connectOptions.alpnProtocols,
        unsafelyDisableHostnameVerification: connectOptions.unsafelyDisableHostnameVerification,
      }),
      signal,
    );
  } catch (error) {
    safeClose(connection);
    throw error;
  }
}

export function installWorkerEgressGuard(options: WorkerEgressGuardOptions = {}): void {
  const globalRecord = globalThis as typeof globalThis & Record<PropertyKey, unknown>;
  if (globalRecord[guardInstalled]) return;

  const runtime = getPinnedEgressRuntime();

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
      runtime,
    });
  };
  Object.defineProperty(fetchWrapper, guardedFetch, { value: true });
  globalThis.fetch = fetchWrapper as typeof fetch;

  if (typeof Deno.connect === "function") {
    const connectWrapper = async (options: unknown): Promise<Deno.TcpConn> => {
      const hostname = getConnectHostname(options);
      if (!hostname || !isObject(options)) {
        throw new WorkerEgressBlockedError(
          "Worker network egress blocked: only guarded TCP connections are available",
        );
      }
      return await guardedWorkerConnect(
        options as unknown as Deno.ConnectOptions,
        baseOptions,
        runtime,
      );
    };
    Object.defineProperty(connectWrapper, guardedConnect, { value: true });
    Deno.connect = connectWrapper as typeof Deno.connect;
  }

  if (typeof Deno.connectTls === "function") {
    const connectTlsWrapper = async (
      options: Parameters<typeof Deno.connectTls>[0],
    ): ReturnType<typeof Deno.connectTls> => {
      return await guardedWorkerConnectTls(options, baseOptions, runtime);
    };
    Object.defineProperty(connectTlsWrapper, guardedConnectTls, { value: true });
    Deno.connectTls = connectTlsWrapper as typeof Deno.connectTls;
  }

  globalRecord[guardInstalled] = true;
}
