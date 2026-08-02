/**
 * Capability audit logging and Deno permission mapping.
 *
 * @module extensions/capabilities
 */

import type { Capability, ExtensionLogger } from "./types.ts";
import {
  applyExtensionMethod,
  freezeExtensionContract,
  getExtensionOwnPropertyDescriptor,
  isDataPropertyDescriptor,
  isExtensionArray,
} from "./property-inspection.ts";

const isInteger = Number.isInteger;
const joinArray = Array.prototype.join;
const mapGet = Map.prototype.get;

/**
 * Format capabilities as human-readable strings for logging.
 */
export function formatCapabilities(capabilities: Capability[]): string[] {
  return capabilities.map((cap) => {
    const { type, ...rest } = cap;
    const extras = Object.keys(rest);
    if (extras.length === 0) return type;

    const details = extras
      .map((key) => `${key}: ${JSON.stringify(rest[key])}`)
      .join(", ");
    return `${type} (${details})`;
  });
}

interface PermissionMapping {
  flag: string;
  scopeKey?: string;
  /** Resolve scopes from the full capability (overrides scopeKey when present). */
  resolveScopes?: (cap: Capability) => string[];
  /** Fail closed instead of emitting an unscoped permission. */
  requireScopes?: boolean;
}

/**
 * Read-only system information kinds from Deno's broader system permission
 * contract. Mutating operations such as `setPriority` are deliberately absent.
 */
const DENO_READ_ONLY_SYSTEM_APIS = freezeExtensionContract(
  [
    "loadavg",
    "hostname",
    "systemMemoryInfo",
    "networkInterfaces",
    "osRelease",
    "osUptime",
    "uid",
    "gid",
    "username",
    "cpus",
    "homedir",
    "statfs",
    "getPriority",
  ] as const,
);

/** Return whether a Deno system permission name is explicitly read-only. */
export function isSupportedDenoSystemReadApi(value: string): boolean {
  for (let index = 0; index < DENO_READ_ONLY_SYSTEM_APIS.length; index++) {
    if (DENO_READ_ONLY_SYSTEM_APIS[index] === value) return true;
  }
  return false;
}

function readOwnDataProperty(
  value: object,
  property: PropertyKey,
  label: string,
  enumerable: boolean,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = getExtensionOwnPropertyDescriptor(value, property);
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected`, { cause });
  }
  if (
    !isDataPropertyDescriptor(descriptor) ||
    descriptor.enumerable !== enumerable
  ) {
    throw new TypeError(
      `${label} must be ${enumerable ? "an enumerable" : "a non-enumerable"} own data property`,
    );
  }
  return descriptor.value;
}

/** Snapshot a dense system-read scope without invoking getters or iterators. */
function resolveSystemReadScopes(capability: Capability): string[] {
  const value = readOwnDataProperty(capability, "apis", "system:read.apis", true);
  if (!isExtensionArray(value)) {
    throw new TypeError("system:read.apis must be a non-empty array");
  }

  const length = readOwnDataProperty(value, "length", "system:read.apis.length", false);
  if (
    !isInteger(length) ||
    (length as number) < 1 ||
    (length as number) > DENO_READ_ONLY_SYSTEM_APIS.length
  ) {
    throw new TypeError(
      `system:read.apis must contain between 1 and ${DENO_READ_ONLY_SYSTEM_APIS.length} entries`,
    );
  }

  const scopes: string[] = [];
  for (let index = 0; index < (length as number); index++) {
    const api = readOwnDataProperty(
      value,
      String(index),
      `system:read.apis[${index}]`,
      true,
    );
    if (typeof api !== "string" || !isSupportedDenoSystemReadApi(api)) {
      throw new TypeError(
        `system:read.apis[${index}] must be a supported read-only Deno system API name`,
      );
    }
    let duplicate = false;
    for (let scopeIndex = 0; scopeIndex < scopes.length; scopeIndex++) {
      if (scopes[scopeIndex] === api) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      scopes[scopes.length] = api;
    }
  }
  return scopes;
}

/** Validate the bounded scope required by a `system:read` capability. */
export function assertSystemReadCapability(capability: Capability): void {
  resolveSystemReadScopes(capability);
}

const DENO_PERMISSION_MAP: ReadonlyMap<string, PermissionMapping> = new Map<
  string,
  PermissionMapping
>([
  ["fs:read", { flag: "--allow-read", scopeKey: "paths" }],
  ["fs:write", { flag: "--allow-write", scopeKey: "paths" }],
  ["net:outbound", { flag: "--allow-net", scopeKey: "hosts" }],
  ["net:listen", {
    flag: "--allow-net",
    resolveScopes: (cap: Capability) => {
      const ports = cap.ports as (string | number)[] | undefined;
      if (!ports || ports.length === 0) return [];
      const host = (cap.host as string) || "localhost";
      return ports.map((p) => `${host}:${p}`);
    },
  }],
  ["env:read", { flag: "--allow-env", scopeKey: "keys" }],
  ["process:spawn", { flag: "--allow-run", scopeKey: "commands" }],
  [
    "system:read",
    {
      flag: "--allow-sys",
      resolveScopes: resolveSystemReadScopes,
      requireScopes: true,
    },
  ],
  ["native:ffi", { flag: "--allow-ffi" }],
]);

/**
 * Map capabilities to Deno CLI permission flags.
 * Skips capabilities without a Deno permission mapping.
 */
export function mapToDenoPermissions(capabilities: Capability[]): string[] {
  const flags: string[] = [];

  for (let capabilityIndex = 0; capabilityIndex < capabilities.length; capabilityIndex++) {
    const cap = capabilities[capabilityIndex]!;
    const mapping = applyExtensionMethod(mapGet, DENO_PERMISSION_MAP, [
      cap.type,
    ]) as PermissionMapping | undefined;
    if (!mapping) continue;

    let flag = mapping.flag;
    let scopes: string[];
    if (mapping.resolveScopes) {
      scopes = mapping.resolveScopes(cap);
    } else if (mapping.scopeKey) {
      const configuredScopes = cap[mapping.scopeKey];
      if (configuredScopes === undefined) {
        scopes = [];
      } else if (
        !Array.isArray(configuredScopes) ||
        configuredScopes.some((scope) => typeof scope !== "string")
      ) {
        throw new TypeError(`${cap.type} scoped permissions must be a string array`);
      } else {
        scopes = configuredScopes;
      }
    } else {
      scopes = [];
    }
    if (mapping.requireScopes && scopes.length === 0) {
      throw new TypeError(`${cap.type} must resolve at least one scoped permission`);
    }
    if (scopes.length > 0) {
      flag = `${flag}=${applyExtensionMethod(joinArray, scopes, [","])}`;
    }

    let duplicate = false;
    for (let flagIndex = 0; flagIndex < flags.length; flagIndex++) {
      if (flags[flagIndex] === flag) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      flags[flags.length] = flag;
    }
  }

  return flags;
}

/**
 * Log capabilities for a named extension at startup.
 */
export function auditCapabilities(
  extensionName: string,
  capabilities: Capability[],
  logger: ExtensionLogger,
): void {
  if (capabilities.length === 0) return;

  const lines = formatCapabilities(capabilities);
  logger.debug(`Extension "${extensionName}" declares capabilities:`, ...lines);
}
