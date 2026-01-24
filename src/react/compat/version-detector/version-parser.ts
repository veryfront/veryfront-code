import type { ParsedVersion } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

export function parseVersion(versionString: string): ParsedVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(versionString);

  if (!match) {
    throw toError(
      createError({
        type: "config",
        message: `Invalid React version format: ${versionString}`,
      }),
    );
  }

  const major = match[1]!;
  const minor = match[2]!;
  const patch = match[3]!;

  return {
    major: parseInt(major, 10),
    minor: parseInt(minor, 10),
    patch: parseInt(patch, 10),
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
