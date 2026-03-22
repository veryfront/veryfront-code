import denoConfig from "#deno-config" with { type: "json" };
import { getEnv } from "#veryfront/platform/compat/process.ts";

// Keep in sync with deno.json version.
// scripts/release.ts updates this constant during releases.
export const VERSION = "0.1.91";

export function normalizeVeryfrontVersion(version: string | undefined): string | undefined {
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

export function resolveRuntimeVersion(options: {
  veryfrontVersion?: string;
  releaseVersion?: string;
  denoVersion?: string;
  fallbackVersion?: string;
} = {}): string {
  return normalizeVeryfrontVersion(options.veryfrontVersion ?? options.releaseVersion) ??
    normalizeVeryfrontVersion(options.denoVersion) ??
    options.fallbackVersion ??
    VERSION;
}

export const RUNTIME_VERSION = resolveRuntimeVersion({
  veryfrontVersion: getVersionEnv("VERYFRONT_VERSION"),
  releaseVersion: getVersionEnv("RELEASE_VERSION"),
  denoVersion: typeof denoConfig.version === "string" ? denoConfig.version : undefined,
  fallbackVersion: VERSION,
});

export const SERVER_START_TIME: number = Date.now();

export interface BuildVersion {
  framework: string;
  serverStart: number;
  projectUpdated?: string;
}

export function createBuildVersion(projectUpdatedAt?: string): BuildVersion {
  return {
    framework: RUNTIME_VERSION,
    serverStart: SERVER_START_TIME,
    projectUpdated: projectUpdatedAt,
  };
}
