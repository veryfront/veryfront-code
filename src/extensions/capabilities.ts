/**
 * Capability audit logging and Deno permission mapping.
 *
 * @module extensions/capabilities
 */

import type { Capability, ExtensionLogger } from "./types.ts";
import { describeThrownValue, stringifyAuditValue } from "./safe-value.ts";

/**
 * Format capabilities as human-readable strings for logging.
 */
export function formatCapabilities(capabilities: Capability[]): string[] {
  return capabilities.map((cap) => {
    let type: unknown;
    try {
      type = cap.type;
    } catch (error) {
      return `[invalid capability: ${describeThrownValue(error)}]`;
    }

    let extras: string[];
    try {
      extras = Object.keys(cap).filter((key) => key !== "type");
    } catch (error) {
      return `${String(type)} ([unavailable: ${describeThrownValue(error)}])`;
    }
    if (extras.length === 0) return String(type);

    const details = extras
      .map((key) => {
        try {
          return `${key}: ${stringifyAuditValue(cap[key])}`;
        } catch (error) {
          return `${key}: [unavailable: ${describeThrownValue(error)}]`;
        }
      })
      .join(", ");
    return `${type} (${details})`;
  });
}

interface PermissionMapping {
  flag: string;
  scopeKey?: string;
}

const DENO_PERMISSION_MAP: Record<string, PermissionMapping> = {
  "fs:read": { flag: "--allow-read", scopeKey: "paths" },
  "fs:write": { flag: "--allow-write", scopeKey: "paths" },
  "net:outbound": { flag: "--allow-net", scopeKey: "hosts" },
  "net:listen": { flag: "--allow-net" },
  "env:read": { flag: "--allow-env", scopeKey: "keys" },
  "process:spawn": { flag: "--allow-run", scopeKey: "commands" },
  "native:ffi": { flag: "--allow-ffi" },
};

function readStringScopes(
  capability: Capability,
  index: number,
  key: string,
): string[] {
  let value: unknown;
  try {
    value = capability[key];
  } catch (cause) {
    throw new TypeError(`capabilities[${index}].${key} could not be read`, {
      cause,
    });
  }
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new TypeError(
      `capabilities[${index}].${key} must be an array of non-empty strings`,
    );
  }
  return value;
}

function normalizeListenPort(value: unknown, label: string): string {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65_535
  ) {
    return String(value);
  }
  if (
    typeof value === "string" &&
    /^(?:[1-9]\d{0,4})$/.test(value) &&
    Number(value) <= 65_535
  ) {
    return value;
  }
  throw new TypeError(`${label} must be an integer from 1 through 65535`);
}

function resolveListenScopes(
  capability: Capability,
  index: number,
): string[] {
  let ports: unknown;
  try {
    ports = capability.ports;
  } catch (cause) {
    throw new TypeError(`capabilities[${index}].ports could not be read`, {
      cause,
    });
  }
  if (ports === undefined) return [];
  if (!Array.isArray(ports)) {
    throw new TypeError(`capabilities[${index}].ports must be an array of port numbers`);
  }

  let host: unknown;
  try {
    host = capability.host;
  } catch (cause) {
    throw new TypeError(`capabilities[${index}].host could not be read`, {
      cause,
    });
  }
  if (host === undefined) host = "localhost";
  if (
    typeof host !== "string" ||
    host.length === 0 ||
    host.trim() !== host
  ) {
    throw new TypeError(
      `capabilities[${index}].host must be a non-empty string without surrounding whitespace`,
    );
  }

  return ports.map((port, portIndex) =>
    `${host}:${normalizeListenPort(port, `capabilities[${index}].ports[${portIndex}]`)}`
  );
}

/**
 * Map capabilities to Deno CLI permission flags.
 *
 * Skips capabilities without a Deno permission mapping. Recognized capability
 * types are validated at runtime and throw `TypeError` rather than emitting an
 * invalid or unexpectedly broad permission flag.
 */
export function mapToDenoPermissions(capabilities: Capability[]): string[] {
  const seen = new Set<string>();
  const flags: string[] = [];

  for (const [index, cap] of capabilities.entries()) {
    let type: unknown;
    try {
      type = cap.type;
    } catch (cause) {
      throw new TypeError(`capabilities[${index}].type could not be read`, {
        cause,
      });
    }
    if (typeof type !== "string" || type.length === 0) {
      throw new TypeError(`capabilities[${index}].type must be a non-empty string`);
    }

    const mapping = DENO_PERMISSION_MAP[type];
    if (!mapping) continue;

    let flag = mapping.flag;
    const scopes = type === "net:listen"
      ? resolveListenScopes(cap, index)
      : mapping.scopeKey
      ? readStringScopes(cap, index, mapping.scopeKey)
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
  if (capabilities.length === 0) return;

  const lines = formatCapabilities(capabilities);
  logger.debug(`Extension "${extensionName}" declares capabilities:`, ...lines);
}
