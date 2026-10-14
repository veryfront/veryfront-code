import { PLATFORM_TOOL_RESULT_MAX_SERIALIZED_BYTES } from "../platform-tool-result-limits.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import {
  JSON_VALUE_MAX_STRING_BYTES,
  snapshotBoundedJsonValue,
} from "#veryfront/schemas/json-value.ts";
import type { ChildRunToolCallSnapshot, ChildRunToolResultSnapshot } from "./execution-snapshot.ts";

const hasOwn = Object.hasOwn;
const descriptor = Object.getOwnPropertyDescriptor;

interface ChildResultTelemetry {
  toolCalls: ChildRunToolCallSnapshot[];
  toolResults: ChildRunToolResultSnapshot[];
  toolTelemetryOmitted?: { calls: number; results: number };
}

type BoundedChildResult<T> = Omit<T, "toolCalls" | "toolResults"> & ChildResultTelemetry;

function isAdmitted(value: unknown): boolean {
  const snapshot = snapshotBoundedJsonValue(
    value,
    JSON_VALUE_MAX_STRING_BYTES,
    PLATFORM_TOOL_RESULT_MAX_SERIALIZED_BYTES,
  );
  if (!snapshot.success) return false;
  try {
    // Provenance serializes this enclosing identity record, not the result alone.
    privateJsonStringify({
      toolCallId: "",
      toolName: "",
      providerExecuted: false,
      result: snapshot.value,
    });
    return true;
  } catch {
    return false;
  }
}

/** Bound copied tool telemetry without changing the accepted child response. */
export function boundChildResultTelemetry<T extends ChildResultTelemetry>(
  result: T,
): BoundedChildResult<T> {
  if (isAdmitted(result)) return result;
  const base = { ...result, toolCalls: [], toolResults: [] };
  // Invalid or oversized accepted output never gains provenance by dropping telemetry.
  if (!isAdmitted(base)) return result;
  // Trace identities must be own data; normalization never invokes telemetry accessors.
  for (const entry of [...result.toolCalls, ...result.toolResults]) {
    for (const key of ["toolName", "toolCallId"]) {
      const field = descriptor(entry, key);
      if (!field || !hasOwn(field, "value") || typeof field.value !== "string") return result;
    }
  }
  const toolCalls = result.toolCalls.map((call) => ({
    toolName: call.toolName,
    toolCallId: call.toolCallId,
    ...(hasOwn(call, "input") ? { input: "[Truncated child telemetry]" } : {}),
  }));
  const toolResults = result.toolResults.map((entry) => ({
    toolName: entry.toolName,
    toolCallId: entry.toolCallId,
    input: "[Truncated child telemetry]",
    output: "[Truncated child telemetry]",
  }));
  const bounded = { ...result, toolCalls, toolResults };
  if (isAdmitted(bounded)) return bounded;
  // Keep the largest admitted trace prefix and report the omitted entry counts.
  let low = 0;
  let high = Math.max(toolCalls.length, toolResults.length);
  let admitted: BoundedChildResult<T> = base;
  while (low <= high) {
    const count = Math.floor((low + high) / 2);
    const candidate = {
      ...base,
      toolCalls: toolCalls.slice(0, count),
      toolResults: toolResults.slice(0, count),
      toolTelemetryOmitted: {
        calls: (result.toolTelemetryOmitted?.calls ?? 0) + Math.max(0, toolCalls.length - count),
        results: (result.toolTelemetryOmitted?.results ?? 0) +
          Math.max(0, toolResults.length - count),
      },
    };
    if (isAdmitted(candidate)) {
      admitted = candidate;
      low = count + 1;
    } else high = count - 1;
  }
  return admitted;
}
