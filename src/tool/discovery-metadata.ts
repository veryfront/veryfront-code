import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { ToolDiscoveryMetadata } from "./types.ts";

/** Read bounded navigation hints without changing executable tool authorization. */
export function normalizeToolDiscoveryMetadata(value: unknown): ToolDiscoveryMetadata | undefined {
  const snapshot = snapshotBoundedJsonValue(value, 512, 2_048);
  if (
    !snapshot.success || typeof snapshot.value !== "object" || snapshot.value === null ||
    Array.isArray(snapshot.value)
  ) return undefined;
  const record = snapshot.value;
  if (record.version !== 1 || (record.type !== "platform" && record.type !== "integration")) {
    return undefined;
  }
  const result: ToolDiscoveryMetadata = { version: 1, type: record.type };
  const navigationKeys = ["domain", "resource", "subgroup", "operation"] as const;
  for (let index = 0; index < navigationKeys.length; index++) {
    const key = navigationKeys[index]!;
    const entry = record[key];
    if (entry === undefined) continue;
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 128) return undefined;
    result[key] = entry;
  }
  return result;
}
