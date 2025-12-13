import type { ParsedVersion } from "./types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

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

/**
 * Determines if the React version is React 19.
 * React 19 RC versions have format like "19.0.0-rc.0"
 */
export function isReact19(major: number, version: string): boolean {
  // Only major version 19 counts as React 19
  // Note: "18.x.x-rc" versions are still React 18 (e.g., "18.3.0-canary")
  // Only "19.x.x-rc" versions should be treated as React 19
  return major === 19 || version.startsWith("19.");
}
