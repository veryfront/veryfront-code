/**
 * Capability audit logging and Deno permission mapping.
 *
 * @module extensions/capabilities
 */

import type { Capability, ExtensionLogger } from "./types.ts";

/**
 * Format capabilities as human-readable strings for logging.
 */
export function formatCapabilities(capabilities: Capability[]): string[] {
  return capabilities.map((cap) => {
    if (cap.type === "contract") {
      return `contract: ${cap.name as string}`;
    }

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
  /** Transform scope values before joining (e.g., ports → host:port). */
  transformScope?: (value: string) => string;
}

const DENO_PERMISSION_MAP: Record<string, PermissionMapping> = {
  "fs:read": { flag: "--allow-read", scopeKey: "paths" },
  "fs:write": { flag: "--allow-write", scopeKey: "paths" },
  "net:outbound": { flag: "--allow-net", scopeKey: "hosts" },
  "net:listen": {
    flag: "--allow-net",
    scopeKey: "ports",
    transformScope: (port) => `0.0.0.0:${port}`,
  },
  "env:read": { flag: "--allow-env", scopeKey: "keys" },
  "process:spawn": { flag: "--allow-run", scopeKey: "commands" },
  "native:ffi": { flag: "--allow-ffi" },
};

/**
 * Map capabilities to Deno CLI permission flags.
 * Skips non-system capabilities (e.g., "contract").
 */
export function mapToDenoPermissions(capabilities: Capability[]): string[] {
  const seen = new Set<string>();
  const flags: string[] = [];

  for (const cap of capabilities) {
    const mapping = DENO_PERMISSION_MAP[cap.type];
    if (!mapping) continue;

    let flag = mapping.flag;
    if (mapping.scopeKey) {
      const scopes = cap[mapping.scopeKey] as string[] | undefined;
      if (scopes && scopes.length > 0) {
        const values = mapping.transformScope ? scopes.map(mapping.transformScope) : scopes;
        flag = `${flag}=${values.join(",")}`;
      }
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
  logger.info(`Extension "${extensionName}" declares capabilities:`, ...lines);
}
