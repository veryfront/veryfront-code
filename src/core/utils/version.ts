import denoConfig from "../../../deno.json" with { type: "json" };
import { getEnv } from "@veryfront/platform/compat/process.ts";

export const VERSION: string = getEnv("VERYFRONT_VERSION") ||
  (typeof denoConfig.version === "string" ? denoConfig.version : "0.0.0");

export const SERVER_START_TIME: number = Date.now();

export interface BuildVersion {
  framework: string;
  serverStart: number;
  projectUpdated?: string;
}

export function createBuildVersion(projectUpdatedAt?: string): BuildVersion {
  return {
    framework: VERSION,
    serverStart: SERVER_START_TIME,
    projectUpdated: projectUpdatedAt,
  };
}
