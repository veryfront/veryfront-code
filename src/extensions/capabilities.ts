/**
 * Capability audit logging and Deno permission mapping.
 *
 * @module extensions/capabilities
 */

import type { Capability, ExtensionLogger } from "./types.ts";
import {
  hasControlCharacters,
  identifierIssue,
  MAX_CAPABILITY_TYPE_LENGTH,
  MAX_EXTENSION_NAME_LENGTH,
} from "./identifiers.ts";

const MAX_PERMISSION_SCOPES = 128;
const MAX_PERMISSION_SCOPE_LENGTH = 4_096;
const MAX_HOST_LENGTH = 253;
const MAX_CAPABILITIES = 128;
const MAX_FORMAT_ENTRIES = 32;
const MAX_FORMAT_DEPTH = 4;
const MAX_FORMAT_NODES = 256;
const MAX_FORMAT_STRING_LENGTH = 256;

function isNonArrayObject(value: unknown): value is Record<PropertyKey, unknown> {
  try {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

function snapshotBoundedArray(
  value: unknown,
  field: string,
  maximumEntries: number,
): unknown[] {
  let isArray: boolean;
  let length: unknown;
  try {
    isArray = Array.isArray(value);
    length = isArray ? Reflect.get(value as object, "length") : undefined;
  } catch {
    throw new TypeError(`${field} could not be read safely`);
  }
  if (
    !isArray || typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
    length > maximumEntries
  ) {
    throw new TypeError(`${field} must be an array with at most ${maximumEntries} entries`);
  }

  const snapshot: unknown[] = [];
  try {
    for (let index = 0; index < length; index++) {
      snapshot.push(Reflect.get(value as object, index));
    }
  } catch {
    throw new TypeError(`${field} could not be read safely`);
  }
  return snapshot;
}

function formatLabel(value: string): string {
  const bounded = value.length <= MAX_FORMAT_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_FORMAT_STRING_LENGTH)}...`;
  return identifierIssue(bounded, MAX_FORMAT_STRING_LENGTH) === undefined
    ? bounded
    : JSON.stringify(bounded);
}

function formatValue(value: unknown): string {
  const seen = new WeakSet<object>();
  let nodes = 0;

  const sanitize = (current: unknown, depth: number): unknown => {
    if (++nodes > MAX_FORMAT_NODES) return "[truncated]";
    if (current === null || typeof current === "boolean") return current;
    if (typeof current === "string") {
      return current.length <= MAX_FORMAT_STRING_LENGTH
        ? current
        : `${current.slice(0, MAX_FORMAT_STRING_LENGTH)}...`;
    }
    if (typeof current === "number") return Number.isFinite(current) ? current : String(current);
    if (typeof current === "bigint") return `${current}n`;
    if (current === undefined) return "[undefined]";
    if (typeof current === "symbol") return "[symbol]";
    if (typeof current === "function") return "[function]";
    if (depth >= MAX_FORMAT_DEPTH) return "[truncated]";

    const object = current as object;
    if (seen.has(object)) return "[circular]";
    seen.add(object);
    try {
      if (Array.isArray(object)) {
        const result: unknown[] = [];
        const length = Math.min(object.length, MAX_FORMAT_ENTRIES);
        for (let index = 0; index < length; index++) {
          result.push(sanitize(Reflect.get(object, index), depth + 1));
        }
        if (object.length > MAX_FORMAT_ENTRIES) result.push("[truncated]");
        return result;
      }

      const result: Record<string, unknown> = Object.create(null);
      const keys = Object.keys(object);
      for (const key of keys.slice(0, MAX_FORMAT_ENTRIES)) {
        const safeKey = formatLabel(key);
        result[safeKey] = sanitize(Reflect.get(object, key), depth + 1);
      }
      if (keys.length > MAX_FORMAT_ENTRIES) result["..."] = "[truncated]";
      return result;
    } catch {
      return "[unavailable]";
    } finally {
      seen.delete(object);
    }
  };

  return JSON.stringify(sanitize(value, 0));
}

function formatCapabilityProperty(capability: Capability, key: string): string {
  try {
    return formatValue(Reflect.get(capability, key));
  } catch {
    return JSON.stringify("[unavailable]");
  }
}

function readCapabilityProperty(capability: Capability, key: string): unknown {
  try {
    return Reflect.get(capability, key);
  } catch {
    throw new TypeError("capability fields could not be read safely");
  }
}

/**
 * Format capabilities as human-readable strings for logging.
 */
export function formatCapabilities(capabilities: Capability[]): string[] {
  const snapshot = snapshotBoundedArray(
    capabilities,
    "capabilities",
    MAX_CAPABILITIES,
  );
  return snapshot.map((cap) => {
    if (!isNonArrayObject(cap)) {
      throw new TypeError("capability must be an object");
    }
    let type: unknown;
    let extras: string[];
    try {
      type = Reflect.get(cap, "type");
      extras = Object.keys(cap).filter((key) => key !== "type");
    } catch {
      throw new TypeError("capability fields could not be read safely");
    }
    if (
      typeof type !== "string" ||
      identifierIssue(type, MAX_CAPABILITY_TYPE_LENGTH) !== undefined
    ) {
      throw new TypeError("capability type is invalid");
    }
    const capability = cap as unknown as Capability;
    if (extras.length === 0) return type;

    const details = extras.slice(0, MAX_FORMAT_ENTRIES)
      .map((key) => `${formatLabel(key)}: ${formatCapabilityProperty(capability, key)}`)
      .join(", ");
    const suffix = extras.length > MAX_FORMAT_ENTRIES ? ', ...: "[truncated]"' : "";
    return `${type} (${details}${suffix})`;
  });
}

interface PermissionMapping {
  flag: string;
  scopeKey?: string;
  /** Resolve scopes from the full capability (overrides scopeKey when present). */
  resolveScopes?: (cap: Capability) => string[];
}

const DENO_PERMISSION_MAP: Record<string, PermissionMapping> = {
  "fs:read": { flag: "--allow-read", scopeKey: "paths" },
  "fs:write": { flag: "--allow-write", scopeKey: "paths" },
  "net:outbound": { flag: "--allow-net", scopeKey: "hosts" },
  "net:listen": {
    flag: "--allow-net",
    resolveScopes: (cap) => {
      const ports = readPorts(readCapabilityProperty(cap, "ports"));
      if (!ports || ports.length === 0) return [];
      const hostValue = readCapabilityProperty(cap, "host");
      const host = hostValue === undefined
        ? "localhost"
        : readPermissionScope("host", hostValue, MAX_HOST_LENGTH);
      return ports.map((p) => `${host}:${p}`);
    },
  },
  "env:read": { flag: "--allow-env", scopeKey: "keys" },
  "process:spawn": { flag: "--allow-run", scopeKey: "commands" },
  "native:ffi": { flag: "--allow-ffi" },
};

function readPermissionScope(field: string, value: unknown, maximumLength: number): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > maximumLength ||
    value.trim() !== value || hasControlCharacters(value) || value.includes(",")
  ) {
    throw new TypeError(`${field} contains an invalid permission scope`);
  }
  return value;
}

function readPermissionScopes(field: string, value: unknown): string[] {
  if (value === undefined) return [];
  return snapshotBoundedArray(value, field, MAX_PERMISSION_SCOPES).map((entry) =>
    readPermissionScope(field, entry, MAX_PERMISSION_SCOPE_LENGTH)
  );
}

function readPorts(value: unknown): string[] {
  if (value === undefined) return [];
  return snapshotBoundedArray(value, "ports", MAX_PERMISSION_SCOPES).map((port) => {
    const normalized = typeof port === "string" && /^[1-9]\d*$/.test(port) ? Number(port) : port;
    if (
      !Number.isSafeInteger(normalized) || (normalized as number) < 1 ||
      (normalized as number) > 65_535
    ) {
      throw new TypeError("ports must contain integers between 1 and 65535");
    }
    return String(normalized);
  });
}

/**
 * Map capabilities to Deno CLI permission flags.
 * Skips capabilities without a Deno permission mapping.
 */
export function mapToDenoPermissions(capabilities: Capability[]): string[] {
  const capabilitySnapshot = snapshotBoundedArray(
    capabilities,
    "capabilities",
    MAX_CAPABILITIES,
  );
  const seen = new Set<string>();
  const flags: string[] = [];

  for (const cap of capabilitySnapshot) {
    if (!isNonArrayObject(cap)) {
      throw new TypeError("capability must be an object");
    }
    let capabilityType: unknown;
    try {
      capabilityType = Reflect.get(cap, "type");
    } catch {
      throw new TypeError("capability fields could not be read safely");
    }
    if (
      typeof capabilityType !== "string" ||
      identifierIssue(capabilityType, MAX_CAPABILITY_TYPE_LENGTH) !== undefined
    ) {
      throw new TypeError("capability type is invalid");
    }
    const capability = cap as unknown as Capability;
    const mapping = Object.hasOwn(DENO_PERMISSION_MAP, capabilityType)
      ? DENO_PERMISSION_MAP[capabilityType]
      : undefined;
    if (!mapping) continue;

    let flag = mapping.flag;
    const scopes = mapping.resolveScopes
      ? mapping.resolveScopes(capability)
      : mapping.scopeKey
      ? readPermissionScopes(
        mapping.scopeKey,
        readCapabilityProperty(capability, mapping.scopeKey),
      )
      : [];
    if (scopes.length > 0) {
      flag = `${flag}=${scopes.join(",")}`;
    }

    if (!seen.has(flag)) {
      seen.add(flag);
      flags.push(flag);
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
  try {
    const capabilityCount = Array.isArray(capabilities)
      ? Reflect.get(capabilities, "length")
      : undefined;
    if (
      typeof capabilityCount !== "number" || !Number.isSafeInteger(capabilityCount) ||
      capabilityCount < 1 || capabilityCount > MAX_CAPABILITIES
    ) {
      return;
    }
    const safeName = identifierIssue(extensionName, MAX_EXTENSION_NAME_LENGTH)
      ? "An extension"
      : `Extension "${extensionName}"`;
    const info = Reflect.get(logger, "info");
    if (typeof info !== "function") return;
    Reflect.apply(info, logger, [
      `${safeName} declares ${capabilityCount} capabilities`,
    ]);
  } catch {
    // Capability auditing must not alter extension lifecycle behavior.
  }
}
