/**
 * Cross-runtime Permission System
 *
 * This module provides a unified permission API that wraps Deno's native
 * permission system. On non-Deno runtimes (Node.js, Bun), permission requests
 * return "denied" as these runtimes don't have a built-in permission model.
 *
 * @module security/sandbox/permission-system
 *
 * @example
 * ```ts
 * import { requestPermission } from "./permission-system.ts";
 *
 * // On Deno: prompts user for permission
 * // On Node/Bun: returns { state: "denied" }
 * const result = await requestPermission({ name: "read", path: "./data" });
 * ```
 */
import { serverLogger } from "@veryfront/utils";
import { isDeno } from "@veryfront/platform/compat/runtime.ts";

export type Permission = "net" | "fs" | "env" | "run" | "read" | "write";

export interface PermissionRequest {
  name: Permission;
  host?: string;
  path?: string;
}

export interface PermissionResult {
  state: "granted" | "denied" | "prompt";
}

// Cross-runtime permission descriptor type (matches Deno's structure)
interface PermissionDescriptor {
  name: string;
  host?: string;
  path?: string;
}

/**
 * Create a permission descriptor from our generic request.
 * Returns a descriptor compatible with Deno's permission system.
 */
function createPermissionDescriptor(
  request: PermissionRequest,
): PermissionDescriptor | null {
  switch (request.name) {
    case "net": {
      const descriptor: PermissionDescriptor = { name: "net" };
      if (request.host) descriptor.host = request.host;
      return descriptor;
    }
    case "read": {
      const descriptor: PermissionDescriptor = { name: "read" };
      if (request.path) descriptor.path = request.path;
      return descriptor;
    }
    case "write": {
      const descriptor: PermissionDescriptor = { name: "write" };
      if (request.path) descriptor.path = request.path;
      return descriptor;
    }
    case "env":
      return { name: "env" };
    case "run":
      return { name: "run" };
    case "fs":
      return null;
    default:
      return null;
  }
}

/**
 * Request permission using Deno's built-in permission system.
 * Deno requires explicit permission grants for security-sensitive operations.
 */
async function requestDenoPermission(
  request: PermissionRequest,
): Promise<PermissionResult> {
  // Check if Deno permissions API is available
  if (
    !isDeno ||
    // @ts-ignore - Deno permissions API
    !("permissions" in Deno) ||
    // @ts-ignore - Deno permissions API
    typeof Deno.permissions?.request !== "function"
  ) {
    return { state: "denied" };
  }

  if (request.name === "fs") {
    const path = request.path;
    // @ts-ignore - Deno permissions API
    const readStatus = await Deno.permissions.request({ name: "read", path });
    if (readStatus.state !== "granted") {
      return { state: readStatus.state };
    }

    // @ts-ignore - Deno permissions API
    const writeStatus = await Deno.permissions.request({ name: "write", path });
    return { state: writeStatus.state };
  }

  const descriptor = createPermissionDescriptor(request);
  if (!descriptor) {
    serverLogger.warn("[permissions] Unsupported permission request", request);
    return { state: "denied" };
  }

  // @ts-ignore - Deno permissions API
  const status = await Deno.permissions.request(descriptor);
  return { state: status.state };
}

/**
 * Request a runtime permission.
 *
 * On Deno: Uses Deno's built-in permission system which requires explicit grants.
 * On Node.js/Bun: Always returns "granted" since these runtimes don't have a
 * permission system - all operations are allowed by default.
 *
 * This abstraction allows code to be written with Deno's security model in mind
 * while still working on other runtimes.
 */
export async function requestPermission(
  request: PermissionRequest,
): Promise<PermissionResult> {
  try {
    if (isDeno) {
      return await requestDenoPermission(request);
    }

    // Node.js and Bun don't have a permission system - everything is allowed.
    // Return "granted" to allow operations to proceed.
    serverLogger.debug("[permissions] Permission auto-granted (non-Deno runtime)", {
      permission: request.name,
    });
    return { state: "granted" };
  } catch (error) {
    serverLogger.warn("[permissions] Permission request failed", {
      permission: request.name,
      error,
    });
    return { state: "denied" };
  }
}
