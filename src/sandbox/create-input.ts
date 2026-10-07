import { CONFIG_INVALID } from "#veryfront/errors";
import type { SandboxOptions } from "./types.ts";

/** @internal Build the public creation request without copying transport credentials. */
export function buildSandboxCreateInput(
  options: SandboxOptions,
  projectReference = options.projectReference,
) {
  const accessScope = options.accessScope ?? "project";
  const ttlMode = options.ttlMode ?? "default";
  if (
    !["project", "private"].includes(accessScope) ||
    !["default", "duration", "always_on"].includes(ttlMode)
  ) {
    throw CONFIG_INVALID.create({ detail: "Invalid sandbox access or lifetime policy" });
  }
  if (
    ttlMode === "duration"
      ? !Number.isInteger(options.ttlHours) || options.ttlHours! <= 0
      : options.ttlHours !== undefined
  ) {
    throw CONFIG_INVALID.create({ detail: "ttlHours is required only for duration cleanup" });
  }
  return {
    access_scope: accessScope,
    ttl_mode: ttlMode,
    ...(projectReference ? { project_reference: projectReference } : {}),
    ...(options.environmentId ? { environment_id: options.environmentId } : {}),
    ...(ttlMode === "duration" ? { ttl_hours: options.ttlHours } : {}),
  };
}

/** @internal Commands inherit project scope from the sandbox. */
export function buildSandboxCommandOptions(options?: import("./types.ts").CommandOptions) {
  return {
    ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options?.timeoutSeconds !== undefined ? { timeout_seconds: options.timeoutSeconds } : {}),
    ...(options?.env !== undefined ? { env: options.env } : {}),
  };
}
