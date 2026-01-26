import denoConfig from "../../deno.js";
import { getVeryfrontVersion } from "../config/env.js";

export const VERSION: string = getVeryfrontVersion() ??
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
