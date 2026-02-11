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
      // @ts-ignore - Deno permissions API
      const canRequest = typeof Deno?.permissions?.request === "function";
      if (!isDeno || !canRequest) return { state: "denied" };

      if (request.name === "fs") {
        const path = request.path;

        // @ts-ignore - Deno permissions API
        const readStatus = await Deno.permissions.request({ name: "read", path });
        if (readStatus.state !== "granted") return { state: readStatus.state };

        // @ts-ignore - Deno permissions API
        const writeStatus = await Deno.permissions.request({ name: "write", path });
        return { state: writeStatus.state };
      }

      const descriptor = createPermissionDescriptor(request);
      if (!descriptor) {
        logger.warn("Unsupported permission request", request);
        return { state: "denied" };
      }

      // @ts-ignore - Deno permissions API
      const status = await Deno.permissions.request(descriptor);
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
