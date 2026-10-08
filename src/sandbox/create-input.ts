import { CONFIG_INVALID } from "#veryfront/errors";
import type { SandboxOptions } from "./types.ts";

/** @internal Build the public creation request without copying transport credentials. */
export function buildSandboxCreateInput(
  options: SandboxOptions,
  projectReference = options.projectReference,
) {
  assertSandboxCreationOptions(options);
  assertSandboxSelector(projectReference, "projectReference");
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

/** @internal Refuse retired selectors instead of silently changing the billing project. */
export function assertSandboxCreationOptions(options: SandboxOptions): void {
  assertSandboxSelector(options.projectReference, "projectReference");
  assertSandboxSelector(options.environmentId, "environmentId");
  if (Object.hasOwn(options, "projectId")) {
    throw CONFIG_INVALID.create({ detail: "Use projectReference instead of projectId" });
  }
}

function assertSandboxSelector(value: unknown, field: string): void {
  if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
    throw CONFIG_INVALID.create({ detail: `${field} must be a non-empty string` });
  }
}
