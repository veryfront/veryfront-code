import { dynamicImport } from "#veryfront/platform/compat/dynamic-import.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

const DEFAULT_PROXY_RUNTIME_PORT = "20000";

export const RUNTIME_OWNER_INVOKE_URL_HEADER = "x-veryfront-runtime-owner-invoke-url";

interface NetworkAddressInfo {
  address?: string;
  family?: string | number;
  internal?: boolean;
}

type DenoNetworkInterface = {
  address: string;
  family?: string | number;
  internal?: boolean;
};

type NodeOsModule = {
  networkInterfaces(): Record<string, NetworkAddressInfo[] | undefined>;
};

type RuntimeOwnerGlobal = typeof globalThis & {
  Deno?: {
    networkInterfaces?: () => ReadonlyArray<DenoNetworkInterface>;
  };
};

interface RuntimeOwnerResolverDeps {
  getHostEnv?: typeof getHostEnv;
  dynamicImport?: typeof dynamicImport;
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
    if (!/^\d+$/.test(part)) {
      return false;
    }

    const octet = Number(part);
    return octet >= 0 && octet <= 255;
  });
}

function isLoopbackIpv4(address: string): boolean {
  return address.startsWith("127.");
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

async function detectRuntimeOwnerHost(
  deps: RuntimeOwnerResolverDeps,
): Promise<string | null> {
  const readHostEnv = deps.getHostEnv ?? getHostEnv;
  const explicitHost =
    readHostEnv("VERYFRONT_RUNTIME_OWNER_HOST") ??
    readHostEnv("POD_IP") ??
    null;

  if (explicitHost?.trim()) {
    return explicitHost.trim();
  }

  const denoInterfaces = deps.getDenoNetworkInterfaces?.() ??
    ((globalThis as RuntimeOwnerGlobal).Deno?.networkInterfaces?.() ?? []);
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
    parsePort(readHostEnv("PORT")) ??
    parsePort(readHostEnv("VERYFRONT_SERVER_PORT")) ??
    parsePort(new URL(req.url).port) ??
    (isTruthyEnv(readHostEnv("PROXY_MODE")) ? DEFAULT_PROXY_RUNTIME_PORT : null)
  );
}

function buildRuntimeOwnerInvokeUrl(host: string, port: string | null): string | null {
  try {
    const url = new URL("http://127.0.0.1/channels/invoke");
    url.hostname = host;
    if (port) {
      url.port = port;
    }
    return url.toString();
  } catch {
    return null;
  }
}

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
