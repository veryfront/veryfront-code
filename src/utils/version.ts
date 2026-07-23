import denoConfig from "#deno-config" with { type: "json" };
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { VERSION } from "./version-constant.ts";
export { VERSION } from "./version-constant.ts";

export function normalizeVeryfrontVersion(version: string | undefined): string | undefined {
  if (!version) return undefined;
  const normalized = version.trim().replace(/^v(?=\d)/, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/.test(normalized)) return undefined;
  return normalized;
}

function getVersionEnv(name: string): string | undefined {
  try {
    return getHostEnv(name);
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
  for (
    const candidate of [
      options.veryfrontVersion,
      options.releaseVersion,
      options.denoVersion,
      options.fallbackVersion,
      VERSION,
    ]
  ) {
    const normalized = normalizeVeryfrontVersion(candidate);
    if (normalized) return normalized;
  }
  return VERSION;
}

export const RUNTIME_VERSION = resolveRuntimeVersion({
  veryfrontVersion: getVersionEnv("VERYFRONT_VERSION"),
  releaseVersion: getVersionEnv("RELEASE_VERSION"),
  denoVersion: typeof denoConfig.version === "string" ? denoConfig.version : undefined,
});

export const SERVER_START_TIME: number = Date.now();

export interface BuildVersion {
  framework: string;
  serverStart: number;
  projectUpdated?: string;
}

export function createBuildVersion(projectUpdated?: string): BuildVersion {
  return {
    framework: RUNTIME_VERSION,
    serverStart: SERVER_START_TIME,
    projectUpdated,
  };
}
