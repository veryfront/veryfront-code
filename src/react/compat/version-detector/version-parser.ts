import type { ParsedVersion } from "./types.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";

export function parseVersion(versionString: string): ParsedVersion {
  const match = versionString.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw toError(createError({
      type: "config",
      message: `Invalid React version format: ${versionString}`,
    }));
  }

  return {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
  };
}

export function isReact17(major: number): boolean {
  return major === 17;
}

export function isReact18(major: number): boolean {
  return major === 18;
}

export function isReact19(major: number, version: string): boolean {
  return major === 19 || (major === 18 && version.includes("rc"));
}
