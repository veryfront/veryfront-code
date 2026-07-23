import { dynamicImport } from "#veryfront/platform/compat/dynamic-import.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

const DEFAULT_PROXY_RUNTIME_PORT = "20000";

/** Response header that pins follow-up requests to the runtime owner. */
export const RUNTIME_OWNER_INVOKE_URL_HEADER = "x-veryfront-runtime-owner-invoke-url";

interface NetworkAddressInfo {
  address?: string;
  family?: string | number;
  internal?: boolean;
}

/** Network interface fields used while resolving a runtime owner address. */
export interface DenoNetworkInterface {
  /** Interface IP address. */
  address: string;
  /** Address family reported by the runtime. */
  family?: string | number;
  /** Whether the interface is internal to the host. */
  internal?: boolean;
}

type NodeOsModule = {
  networkInterfaces(): Record<string, NetworkAddressInfo[] | undefined>;
};

type RuntimeOwnerGlobal = typeof globalThis & {
  Deno?: {
    networkInterfaces?: () => ReadonlyArray<DenoNetworkInterface>;
  };
};

/** Injectable dependencies for runtime owner URL resolution. */
export interface RuntimeOwnerResolverDeps {
  /** Reads a host environment variable. */
  getHostEnv?: (key: string) => string | undefined;
  /** Imports a runtime compatibility module. */
  dynamicImport?: <T>(specifier: string) => Promise<T>;
  /** Returns network interfaces available through Deno. */
  getDenoNetworkInterfaces?: () => ReadonlyArray<DenoNetworkInterface>;
}

function parsePort(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return String(port);
}

function isTruthyEnv(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isIpv4Address(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d+$/.test(part) || (part.length > 1 && part.startsWith("0"))) {
      return false;
    }

    const octet = Number(part);
    return octet >= 0 && octet <= 255;
  });
}

function isLoopbackIpv4(address: string): boolean {
  return address.startsWith("127.");
}

function normalizeRuntimeOwnerHost(value: string | null | undefined): string | null {
  const host = value?.trim();
  if (!host || host.length > 253 || /[\s/@?#\\]/.test(host)) {
    return null;
  }

  if (host.startsWith("[") || host.includes(":")) {
    const ipv6 = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
    if (!ipv6 || ipv6.includes("[") || ipv6.includes("]") || ipv6.includes("%")) {
      return null;
    }
    try {
      return new URL(`http://[${ipv6}]/`).hostname;
    } catch {
      return null;
    }
  }

  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    return isIpv4Address(host) ? host : null;
  }

  const labels = host.split(".");
  if (
    labels.some((label) =>
      label.length === 0 || label.length > 63 ||
      !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
    )
  ) {
    return null;
  }
  const normalized = host.toLowerCase();
  try {
    return new URL(`http://${normalized}/`).hostname === normalized ? normalized : null;
  } catch {
    return null;
  }
}

function selectNetworkIpv4Address(
  candidates: ReadonlyArray<NetworkAddressInfo | DenoNetworkInterface>,
): string | null {
  for (const candidate of candidates) {
    if (
      candidate.internal === true ||
      !isIpv4Address(candidate.address) ||
      isLoopbackIpv4(candidate.address)
    ) {
      continue;
    }

    return candidate.address;
  }

  return null;
}

function getDenoNetworkInterfacesSafe(
  deps: RuntimeOwnerResolverDeps,
): ReadonlyArray<DenoNetworkInterface> {
  try {
    return deps.getDenoNetworkInterfaces?.() ??
      ((globalThis as RuntimeOwnerGlobal).Deno?.networkInterfaces?.() ?? []);
  } catch {
    return [];
  }
}

async function detectRuntimeOwnerHost(
  deps: RuntimeOwnerResolverDeps,
): Promise<string | null> {
  const readHostEnv = deps.getHostEnv ?? getHostEnv;
  const explicitHost = readHostEnv("VERYFRONT_RUNTIME_OWNER_HOST") ??
    readHostEnv("POD_IP") ??
    null;

  if (explicitHost?.trim()) {
    return normalizeRuntimeOwnerHost(explicitHost);
  }

  const denoInterfaces = getDenoNetworkInterfacesSafe(deps);
  const denoHost = selectNetworkIpv4Address(denoInterfaces);
  if (denoHost) {
    return denoHost;
  }

  try {
    const nodeOs = await (deps.dynamicImport ?? dynamicImport)<NodeOsModule>("node:os");
    const nodeInterfaces = Object.values(nodeOs.networkInterfaces()).flatMap(
      (entries) => entries ?? [],
    );
    const nodeHost = selectNetworkIpv4Address(nodeInterfaces);
    if (nodeHost) {
      return nodeHost;
    }
  } catch {
    // Ignore runtime-specific interface lookup failures and fall through.
  }

  return null;
}

function resolveRuntimeOwnerPort(
  req: Request,
  deps: RuntimeOwnerResolverDeps,
): string | null {
  const readHostEnv = deps.getHostEnv ?? getHostEnv;

  return (
    parsePort(readHostEnv("VERYFRONT_RUNTIME_OWNER_PORT")) ??
      parsePort(readHostEnv("VERYFRONT_SERVER_PORT")) ??
      parsePort(new URL(req.url).port) ??
      parsePort(readHostEnv("PORT")) ??
      (isTruthyEnv(readHostEnv("PROXY_MODE")) ? DEFAULT_PROXY_RUNTIME_PORT : null)
  );
}

function buildRuntimeOwnerInvokeUrl(host: string, port: string | null): string | null {
  const normalizedHost = normalizeRuntimeOwnerHost(host);
  if (!normalizedHost) {
    return null;
  }
  try {
    return new URL(
      `http://${normalizedHost}${port ? `:${port}` : ""}/channels/invoke`,
    ).toString();
  } catch {
    return null;
  }
}

/** Resolves the private invoke URL that identifies the current runtime owner. */
export async function resolveRuntimeOwnerInvokeUrl(
  req: Request,
  deps: RuntimeOwnerResolverDeps = {},
): Promise<string | null> {
  const host = await detectRuntimeOwnerHost(deps);
  if (!host) {
    return null;
  }

  return buildRuntimeOwnerInvokeUrl(host, resolveRuntimeOwnerPort(req, deps));
}
