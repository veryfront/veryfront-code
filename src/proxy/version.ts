import denoConfig from "#deno-config" with { type: "json" };
import { getEnv } from "./env.ts";

/** Normalize a bounded, log-safe proxy runtime version string. */
export function normalizeProxyRuntimeVersion(version: string | undefined): string | undefined {
  if (!version || version.length > 128) return undefined;
  const normalized = version.replace(/^v(?=\d)/, "");
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(normalized) ? normalized : undefined;
}

function getVersionEnv(name: string): string | undefined {
  try {
    return getEnv(name);
  } catch {
    return undefined;
  }
}

/** Log-safe version reported by the proxy runtime. */
export const PROXY_RUNTIME_VERSION: string = normalizeProxyRuntimeVersion(
  getVersionEnv("VERYFRONT_VERSION"),
) ?? normalizeProxyRuntimeVersion(getVersionEnv("RELEASE_VERSION")) ??
  normalizeProxyRuntimeVersion(
    typeof denoConfig.version === "string" ? denoConfig.version : undefined,
  ) ??
  "0.0.0";
