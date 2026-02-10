import denoConfig from "#deno-config" with { type: "json" };

function getVersionFromDeno(): string {
  return typeof denoConfig.version === "string" ? denoConfig.version : "0.0.0";
}

// Use deno.json version directly to avoid env access at module load
export const VERSION: string = getVersionFromDeno();

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
