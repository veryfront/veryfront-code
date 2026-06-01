import { serverLogger } from "#veryfront/utils";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const logger = serverLogger.component("permissions");

export type Permission = "net" | "fs" | "env" | "run" | "read" | "write";

export interface PermissionRequest {
  name: Permission;
  host?: string;
  path?: string;
}

export interface PermissionResult {
  state: "granted" | "denied" | "prompt";
}

interface PermissionDescriptor {
  name: string;
  host?: string;
  path?: string;
}

/**
 * Narrow view of the subset of the Deno permissions API this module uses.
 *
 * Typed locally (rather than via lib.deno.d.ts) so this permission-sensitive
 * module stays free of broad ambient globals and avoids importing anything
 * that reads the environment at module load.
 */
interface DenoPermissions {
  request(descriptor: PermissionDescriptor): Promise<{ state: PermissionResult["state"] }>;
}

interface DenoLike {
  permissions?: Partial<DenoPermissions>;
}

/**
 * Access the Deno permissions API through a narrow, typed view.
 * Returns null when not running under Deno or the API is unavailable.
 */
function getDenoPermissions(): DenoPermissions | null {
  const denoGlobal = (globalThis as { Deno?: DenoLike }).Deno;
  const permissions = denoGlobal?.permissions;
  if (!permissions || typeof permissions.request !== "function") return null;
  return permissions as DenoPermissions;
}

function createPermissionDescriptor(
  request: PermissionRequest,
): PermissionDescriptor | null {
  const { name, host, path } = request;

  switch (name) {
    case "net":
      return host ? { name, host } : { name };
    case "read":
    case "write":
      return path ? { name, path } : { name };
    case "env":
    case "run":
      return { name };
    case "fs":
    default:
      return null;
  }
}

function requestDenoPermission(
  request: PermissionRequest,
): Promise<PermissionResult> {
  return withSpan(
    "security.permissions.requestDeno",
    async () => {
      const permissions = getDenoPermissions();
      if (!isDeno || !permissions) return { state: "denied" };

      if (request.name === "fs") {
        const path = request.path;

        const readStatus = await permissions.request({ name: "read", path });
        if (readStatus.state !== "granted") return { state: readStatus.state };

        const writeStatus = await permissions.request({ name: "write", path });
        return { state: writeStatus.state };
      }

      const descriptor = createPermissionDescriptor(request);
      if (!descriptor) {
        logger.warn("Unsupported permission request", request);
        return { state: "denied" };
      }

      const status = await permissions.request(descriptor);
      return { state: status.state };
    },
    { "permission.name": request.name },
  );
}

export function requestPermission(
  request: PermissionRequest,
): Promise<PermissionResult> {
  return withSpan(
    "security.permissions.request",
    async () => {
      try {
        if (isDeno) return await requestDenoPermission(request);

        serverLogger.debug(
          "[permissions] Permission auto-granted (non-Deno runtime)",
          { permission: request.name },
        );
        return { state: "granted" };
      } catch (error) {
        logger.warn("Permission request failed", {
          permission: request.name,
          error,
        });
        return { state: "denied" };
      }
    },
    { "permission.name": request.name },
  );
}
