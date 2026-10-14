import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { ToolDiscoveryMetadata } from "./types.ts";

/** MCP `_meta` key that carries tool discovery metadata across server boundaries. */
export const TOOL_DISCOVERY_META_KEY = "veryfront/tool-discovery";

const getOwnDescriptor = Object.getOwnPropertyDescriptor;
const createObject = Object.create;
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;

/** Read bounded navigation hints without changing executable tool authorization. */
export function normalizeToolDiscoveryMetadata(value: unknown): ToolDiscoveryMetadata | undefined {
  if (
    value === null || typeof value !== "object" || isProxyWithoutHooks(value) ||
    isArray(value)
  ) return undefined;
  const version = readOwn(value, "version");
  const type = readOwn(value, "type");
  if (version !== 1 || (type !== "platform" && type !== "integration")) return undefined;
  const result: ToolDiscoveryMetadata = createObject(null);
  defineOwnDataProperty(result, "version", 1, {
    enumerable: true,
    writable: true,
    configurable: true,
  });
  defineOwnDataProperty(result, "type", type, {
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const navigationKeys = ["domain", "resource", "subgroup", "operation"] as const;
  for (let index = 0; index < navigationKeys.length; index++) {
    const key = navigationKeys[index]!;
    const property = getOwnDescriptor(value, key);
    if (property && !hasOwn(property, "value")) return undefined;
    const entry = property?.value;
    if (entry === undefined) continue;
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 128) return undefined;
    defineOwnDataProperty(result, key, entry, {
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  // Only the projected primitive fields are traversed; arbitrary extensions are inert.
  return snapshotBoundedJsonValue(result, 512, 2_048).success ? result : undefined;
}

function readOwn(value: unknown, key: string): unknown {
  if (
    value === null || (typeof value !== "object" && typeof value !== "function") ||
    isProxyWithoutHooks(value)
  ) return undefined;
  const property = getOwnDescriptor(value, key);
  return property && hasOwn(property, "value") ? property.value : undefined;
}

/** Read optional tool navigation metadata without invoking owner hooks. */
export function readToolDiscoveryMetadata(value: unknown): ToolDiscoveryMetadata | undefined {
  return normalizeToolDiscoveryMetadata(readOwn(value, "discovery"));
}

/** Copy navigation hints as own data without dispatching inherited setters. */
export function copyToolDiscoveryMetadata(source: unknown, target: object): void {
  const discovery = readToolDiscoveryMetadata(source);
  if (discovery) {
    defineOwnDataProperty(target, "discovery", discovery, {
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}

/** Read the standard Veryfront MCP metadata extension without inherited lookups. */
export function readMcpToolDiscoveryMetadata(value: unknown): ToolDiscoveryMetadata | undefined {
  return normalizeToolDiscoveryMetadata(readOwn(readOwn(value, "_meta"), TOOL_DISCOVERY_META_KEY));
}
