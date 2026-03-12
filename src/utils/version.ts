// Keep in sync with deno.json version.
// scripts/release.ts updates this constant during releases.
export const VERSION = "0.1.59";

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
