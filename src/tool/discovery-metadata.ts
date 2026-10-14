import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { ToolDiscoveryMetadata } from "./types.ts";

const getOwnDescriptor = Object.getOwnPropertyDescriptor;

/** Read bounded navigation hints without changing executable tool authorization. */
export function normalizeToolDiscoveryMetadata(value: unknown): ToolDiscoveryMetadata | undefined {
  const snapshot = snapshotBoundedJsonValue(value, 512, 2_048);
  if (
    !snapshot.success || typeof snapshot.value !== "object" || snapshot.value === null ||
    Array.isArray(snapshot.value)
  ) return undefined;
  const record = snapshot.value;
  const version = getOwnDescriptor(record, "version")?.value;
  const type = getOwnDescriptor(record, "type")?.value;
  if (version !== 1 || (type !== "platform" && type !== "integration")) {
    return undefined;
  }
  const result: ToolDiscoveryMetadata = { version: 1, type };
  const navigationKeys = ["domain", "resource", "subgroup", "operation"] as const;
  for (let index = 0; index < navigationKeys.length; index++) {
    const key = navigationKeys[index]!;
    const entry = getOwnDescriptor(record, key)?.value;
    if (entry === undefined) continue;
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 128) return undefined;
    defineOwnDataProperty(result, key, entry, { enumerable: true });
  }
  return result;
}
