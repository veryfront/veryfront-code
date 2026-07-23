/**
 * Bridge Configuration
 *
 * Reads config from window.__VF_BRIDGE_CONFIG__ (injected by the server)
 * and provides typed access to bridge options.
 */

import { logger } from "./bridge-logger.ts";
import {
  MAX_STUDIO_CONFIG_ID_LENGTH,
  MAX_STUDIO_CONFIG_NONCE_LENGTH,
  MAX_STUDIO_CONFIG_PATH_LENGTH,
} from "../limits.ts";

interface BridgeConfig {
  projectId: string;
  pageId: string;
  pagePath: string;
  nonce: string;
}

let config: Readonly<BridgeConfig> | null = null;

const MAX_CONFIG_PROPERTIES = 32;

const DEFAULT_CONFIG: Readonly<BridgeConfig> = Object.freeze({
  projectId: "",
  pageId: "",
  pagePath: "",
  nonce: "",
});

const RETIRED_CONFIG_FIELDS = [
  "wsUrl",
  "yjsGuid",
  "studioMode",
  "debugSkipInit",
  "debugExposeInternals",
] as const;

const SUPPORTED_CONFIG_FIELDS = new Set<string>([
  "projectId",
  "pageId",
  "pagePath",
  "nonce",
]);

function snapshotConfig(raw: Record<string, unknown>): Record<string, unknown> {
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(raw);
  } catch {
    throw new TypeError("Studio bridge config must be a plain data record");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Studio bridge config must be a plain data record");
  }

  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(raw) as Record<PropertyKey, PropertyDescriptor>;
  } catch {
    throw new TypeError("Studio bridge config must be a plain data record");
  }

  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > MAX_CONFIG_PROPERTIES || keys.some((key) => typeof key !== "string")) {
    throw new TypeError(
      `Studio bridge config must contain at most ${MAX_CONFIG_PROPERTIES} data properties`,
    );
  }

  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key]!;
    if (descriptor.get || descriptor.set) {
      throw new TypeError(`Studio bridge config property ${key} must be a data property`);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function assertUnproxiedConfig(raw: Record<string, unknown>): void {
  try {
    // Transparent Proxy objects cannot be identified through reflection, but
    // the structured clone algorithm rejects them. This runs only after every
    // own property is known to be a bounded primitive data field, so cloning
    // cannot invoke accessors or traverse an unbounded value graph.
    structuredClone(raw);
  } catch {
    throw new TypeError("Studio bridge config must be a plain data record");
  }
}

function normalizeString(value: unknown, field: string, maxLength: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new TypeError(`Studio bridge config property ${field} must be a string`);
  }

  if (value.length > maxLength || value.includes("\0")) {
    throw new TypeError(`Studio bridge config property ${field} is invalid or too long`);
  }
  return value;
}

function normalizeConfig(raw?: unknown): Readonly<BridgeConfig> {
  if (raw === undefined) {
    logger.warn("No bridge config found on window.__VF_BRIDGE_CONFIG__");
    return DEFAULT_CONFIG;
  }
  if (raw === null || typeof raw !== "object") {
    throw new TypeError("Studio bridge config must be a plain data record");
  }

  const record = raw as Record<string, unknown>;
  const snapshot = snapshotConfig(record);
  for (const field of RETIRED_CONFIG_FIELDS) {
    if (Object.hasOwn(snapshot, field)) {
      throw new TypeError(`Studio bridge config property ${field} is no longer supported`);
    }
  }
  if (Object.keys(snapshot).some((field) => !SUPPORTED_CONFIG_FIELDS.has(field))) {
    throw new TypeError("Studio bridge config contains an unsupported property");
  }
  const pageId = normalizeString(snapshot.pageId, "pageId", MAX_STUDIO_CONFIG_ID_LENGTH);
  const rawPagePath = snapshot.pagePath ?? snapshot.pageId;
  const normalized = {
    ...DEFAULT_CONFIG,
    projectId: normalizeString(
      snapshot.projectId,
      "projectId",
      MAX_STUDIO_CONFIG_ID_LENGTH,
    ),
    pageId,
    pagePath: normalizeString(rawPagePath, "pagePath", MAX_STUDIO_CONFIG_PATH_LENGTH),
    nonce: normalizeString(snapshot.nonce, "nonce", MAX_STUDIO_CONFIG_NONCE_LENGTH),
  };
  assertUnproxiedConfig(record);
  return Object.freeze(normalized);
}

export function initConfig(): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "__VF_BRIDGE_CONFIG__");
  if (descriptor?.get || descriptor?.set) {
    throw new TypeError("Studio bridge config must be injected as a data property");
  }
  const raw = descriptor?.value;
  config = normalizeConfig(raw);
}

export function getConfig(): BridgeConfig {
  if (!config) {
    throw new Error("[StudioBridge] Config not initialized. Call initConfig() first.");
  }
  return config;
}

/** Set config directly (for tests only). */
export function setConfigForTest(override: Partial<BridgeConfig>): void {
  config = Object.freeze({
    ...DEFAULT_CONFIG,
    ...override,
  });
}
