import { AG_UI_PROTOCOL_VERSION } from "#veryfront/events/ag-ui/schema.ts";
import type { AgUiEvent } from "#veryfront/events/ag-ui/types.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { JsonObject } from "#veryfront/events/types.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

export function requireStringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}

export function requireLiteral<TLiteral extends string>(
  value: unknown,
  expected: TLiteral,
  label: string,
): TLiteral {
  if (value !== expected) throw new TypeError(`${label} must be ${expected}`);
  return expected;
}

export function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, label);
}

export function optionalStringValue(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireStringValue(value, label);
}

export function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number") throw new TypeError(`${label} must be a number`);
  return value;
}

export function toJsonObject(value: unknown): JsonObject | undefined {
  const snapshot = snapshotBoundedJsonValue(value);
  if (!snapshot.success) return undefined;
  return isRecord(snapshot.value) ? snapshot.value : undefined;
}

export function invocationSubagentRunId(record: Record<string, unknown>): string | undefined {
  const attribution = record.attribution;
  if (attribution === undefined) return undefined;
  const attributionRecord = requireRecord(attribution, "protocol.agui.attribution");
  const invocation = attributionRecord.invocation;
  if (invocation === undefined) return undefined;
  const invocationRecord = requireRecord(invocation, "protocol.agui.attribution.invocation");
  return requireStringValue(
    invocationRecord.subagentRunId,
    "protocol.agui.attribution.invocation.subagentRunId",
  );
}

export function reservedExtensions(
  record: Record<string, unknown>,
  knownFields: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const extensions = record.extensions;
  if (extensions === undefined) return undefined;
  const extensionRecord = requireRecord(extensions, "protocol.agui.extensions");
  for (const key of Object.keys(extensionRecord)) {
    if (knownFields.has(key)) {
      throw new TypeError(`protocol.agui.extensions must not contain reserved AG-UI field ${key}`);
    }
  }
  return extensionRecord;
}

export function aguiEnvelopeBase(
  record: Record<string, unknown>,
  knownFields: ReadonlySet<string>,
) {
  return {
    ...(reservedExtensions(record, knownFields) ?? {}),
    ...(record.timestamp === undefined
      ? {}
      : { timestamp: optionalNumber(record.timestamp, "protocol.agui.timestamp") }),
    ...(record.rawEvent === undefined ? {} : { rawEvent: record.rawEvent }),
    ...(record.metadata === undefined
      ? {}
      : { metadata: requireRecord(record.metadata, "protocol.agui.metadata") }),
  };
}

export function aguiBase(
  record: Record<string, unknown> | undefined,
  knownFields: ReadonlySet<string>,
) {
  if (record === undefined) return {};
  return {
    ...aguiEnvelopeBase(record, knownFields),
    ...(invocationSubagentRunId(record) === undefined
      ? {}
      : { subagentRunId: invocationSubagentRunId(record) }),
  };
}

interface NativeOccurrence {
  readonly source: string;
  readonly id: string;
  readonly time?: string;
  readonly recordedat?: string;
}

interface NativeContextFields {
  readonly runkind?: "agent" | "workflow" | "task";
  readonly conversationid?: string;
  readonly subject?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
}

export function nativeOccurrenceFields(occurrence: NativeOccurrence) {
  return {
    source: occurrence.source,
    id: occurrence.id,
    ...(occurrence.time === undefined ? {} : { time: occurrence.time }),
    ...(occurrence.recordedat === undefined ? {} : { recordedat: occurrence.recordedat }),
  };
}

export function nativeContextFields(context: NativeContextFields) {
  return {
    ...(context.runkind === undefined ? {} : { runkind: context.runkind }),
    ...(context.conversationid === undefined ? {} : { conversationid: context.conversationid }),
    ...(context.subject === undefined ? {} : { subject: context.subject }),
    ...(context.traceparent === undefined ? {} : { traceparent: context.traceparent }),
    ...(context.tracestate === undefined ? {} : { tracestate: context.tracestate }),
  };
}

export function extensionFields(
  event: AgUiEvent,
  knownFields: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const entries = Object.entries(event).filter(([key]) => !knownFields.has(key));
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

export function protocolMetadataFields(event: AgUiEvent, knownFields: ReadonlySet<string>) {
  const extensionData = extensionFields(event, knownFields);
  return {
    ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
    ...(event.rawEvent === undefined ? {} : { rawEvent: event.rawEvent }),
    ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
    ...(extensionData === undefined ? {} : { extensions: extensionData }),
    ...(event.subagentRunId === undefined
      ? {}
      : { attribution: { invocation: { subagentRunId: event.subagentRunId } } }),
  };
}

export function baseProtocolMetadata(event: AgUiEvent, knownFields: ReadonlySet<string>) {
  return {
    name: "ag-ui",
    version: AG_UI_PROTOCOL_VERSION,
    eventType: event.type,
    ...protocolMetadataFields(event, knownFields),
  };
}
