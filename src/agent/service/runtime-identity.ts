import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { getHostEnvExcludingEnvFile } from "#veryfront/platform/compat/process.ts";

export const RUNTIME_ID_HEADER = "x-veryfront-runtime-id";
export const RUNTIME_NAME_HEADER = "x-veryfront-runtime-name";
export const RUNTIME_MODE_HEADER = "x-veryfront-runtime-mode";

/** Identity of the service process, independent of its load-balanced endpoint. */
export type ServiceRuntimeIdentity = Readonly<{
  id: string;
  name: string;
  mode: "service";
}>;

/** Validate before accepting work so invalid display names cannot break a response. */
export function resolveServiceRuntimeName(
  configured: string | undefined,
  readHostname: () => string = hostname,
): string {
  const explicit = configured?.trim();
  if (explicit) {
    if (explicit.length > 128 || /\p{Cc}/u.test(explicit)) {
      throw new Error(
        "VERYFRONT_RUNTIME_NAME must contain at most 128 characters without control characters.",
      );
    }
    try {
      encodeURIComponent(explicit);
    } catch {
      throw new Error("VERYFRONT_RUNTIME_NAME must contain valid Unicode.");
    }
    return explicit;
  }
  try {
    const name = readHostname().trim().slice(0, 128);
    if (name && !/\p{Cc}/u.test(name)) {
      encodeURIComponent(name);
      return name;
    }
  } catch {
    // Hostname lookup is optional; process identity must still be available.
  }
  return "Service runtime";
}

let processIdentity: ServiceRuntimeIdentity | undefined;

/** All route sets in this process share one ID; a new process generates a new ID. */
export function getServiceRuntimeIdentity(): ServiceRuntimeIdentity {
  return processIdentity ??= Object.freeze({
    id: randomUUID(),
    name: resolveServiceRuntimeName(getHostEnvExcludingEnvFile("VERYFRONT_RUNTIME_NAME")),
    mode: "service",
  });
}
