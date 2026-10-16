import { hostname } from "node:os";
import { getHostEnvExcludingEnvFile } from "#veryfront/platform/compat/process.ts";
import { getEnvSource } from "veryfront/utils/env-loader";

/** Resolve once during trusted CLI setup; never derive identity from project code. */
export function resolveLocalWorkerName(
  configured: string | undefined,
  readHostname: () => string = hostname,
): string {
  const explicit = configured?.trim();
  if (explicit) {
    if (explicit.length > 128) {
      throw new Error("VERYFRONT_WORKER_NAME must be at most 128 characters.");
    }
    return explicit;
  }
  try {
    return readHostname().trim().slice(0, 128) || "Local development";
  } catch {
    return "Local development";
  }
}

export function captureLocalWorkerName(): string {
  const configured = getEnvSource("VERYFRONT_WORKER_NAME").source === "process"
    ? getHostEnvExcludingEnvFile("VERYFRONT_WORKER_NAME")
    : undefined;
  return resolveLocalWorkerName(configured);
}
