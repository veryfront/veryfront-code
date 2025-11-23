import { serverLogger } from "@veryfront/utils";

export type Permission = "net" | "fs" | "env" | "run" | "read" | "write";

export interface PermissionRequest {
  name: Permission;
  host?: string;
  path?: string;
}

export interface PermissionResult {
  state: "granted" | "denied" | "prompt";
}

function createDenoDescriptor(
  request: PermissionRequest,
): Deno.PermissionDescriptor | null {
  switch (request.name) {
    case "net": {
      const descriptor: Deno.NetPermissionDescriptor = { name: "net" };
      if (request.host) descriptor.host = request.host;
      return descriptor;
    }
    case "read": {
      const descriptor: Deno.ReadPermissionDescriptor = { name: "read" };
      if (request.path) descriptor.path = request.path;
      return descriptor;
    }
    case "write": {
      const descriptor: Deno.WritePermissionDescriptor = { name: "write" };
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

async function requestDenoPermission(
  request: PermissionRequest,
): Promise<PermissionResult> {
  if (!("permissions" in Deno) || typeof Deno.permissions.request !== "function") {
    return { state: "denied" };
  }

  if (request.name === "fs") {
    const path = request.path;
    const readStatus = await Deno.permissions.request({
      name: "read",
      path,
    } as Deno.ReadPermissionDescriptor);
    if (readStatus.state !== "granted") {
      return { state: readStatus.state };
    }

    const writeStatus = await Deno.permissions.request({
      name: "write",
      path,
    } as Deno.WritePermissionDescriptor);
    return { state: writeStatus.state };
  }

  const descriptor = createDenoDescriptor(request);
  if (!descriptor) {
    serverLogger.warn("[permissions] Unsupported permission request", request);
    return { state: "denied" };
  }

  const status = await Deno.permissions.request(descriptor);
  return { state: status.state };
}

export async function requestPermission(
  request: PermissionRequest,
): Promise<PermissionResult> {
  try {
    if (typeof Deno !== "undefined") {
      return await requestDenoPermission(request);
    }

    serverLogger.warn("[permissions] Permission requests are not supported in this runtime", {
      permission: request.name,
    });
    return { state: "denied" };
  } catch (error) {
    serverLogger.warn("[permissions] Permission request failed", {
      permission: request.name,
      error,
    });
    return { state: "denied" };
  }
}
