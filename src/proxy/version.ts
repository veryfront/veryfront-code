import denoConfig from "#deno-config" with { type: "json" };
import { getEnv } from "./env.ts";

function normalizeVersion(version: string | undefined): string | undefined {
  if (!version) return undefined;
  return version.replace(/^v(?=\d)/, "");
}

function getVersionEnv(name: string): string | undefined {
  try {
    return getEnv(name);
  } catch {
    return undefined;
  }
}

export const PROXY_RUNTIME_VERSION = normalizeVersion(
  getVersionEnv("VERYFRONT_VERSION") ?? getVersionEnv("RELEASE_VERSION"),
) ??
  normalizeVersion(typeof denoConfig.version === "string" ? denoConfig.version : undefined) ??
  "0.0.0";
