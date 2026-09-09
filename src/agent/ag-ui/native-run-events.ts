/**
 * Native run event vocabulary shared by every emission path.
 *
 * Veryfront Code used to wrap these eight occurrences in an AG-UI `Custom`
 * frame and let the API translate the custom name back into a type. The API
 * now accepts the native names, so this module owns the list once: the wire
 * name a live SSE frame carries, the stored type a durable record carries, and
 * the legacy custom name each one replaces. Both encoders build their frames
 * here, so the live and durable shapes cannot drift apart.
 */

/** One native run event: its wire name, stored type, and the custom name it replaces. */
export interface NativeRunEventDefinition {
  wireName: string;
  storedType: string;
  legacyCustomName: string;
}

/** The native run events this runtime emits, in catalog order. */
export const NATIVE_RUN_EVENTS = [
  {
    wireName: "ToolCallStatusChanged",
    storedType: "TOOL_CALL_STATUS_CHANGED",
    legacyCustomName: "tool-call-status",
  },
  {
    wireName: "InputRequestCreated",
    storedType: "INPUT_REQUEST_CREATED",
    legacyCustomName: "veryfront.input_request.lifecycle",
  },
  {
    wireName: "InputRequestUpdated",
    storedType: "INPUT_REQUEST_UPDATED",
    legacyCustomName: "veryfront.input_request.lifecycle",
  },
  {
    wireName: "ChildRunStatusChanged",
    storedType: "CHILD_RUN_STATUS_CHANGED",
    legacyCustomName: "veryfront.invoke_agent.lifecycle",
  },
  { wireName: "UrlCited", storedType: "URL_CITED", legacyCustomName: "source-url" },
  {
    wireName: "DocumentCited",
    storedType: "DOCUMENT_CITED",
    legacyCustomName: "source-document",
  },
  { wireName: "FileAttached", storedType: "FILE_ATTACHED", legacyCustomName: "file" },
  {
    wireName: "RuntimeEventRecorded",
    storedType: "RUNTIME_EVENT_RECORDED",
    legacyCustomName: "veryfront.runtime_context",
  },
] as const satisfies readonly NativeRunEventDefinition[];

type NativeRunEventEntry = (typeof NATIVE_RUN_EVENTS)[number];

/** AG-UI wire name of a native run event. */
export type NativeRunEventWireName = NativeRunEventEntry["wireName"];

/** Durable record type of a native run event. */
export type NativeRunEventStoredType = NativeRunEventEntry["storedType"];

/** Custom event name a native run event replaces. */
export type NativeRunEventLegacyName = NativeRunEventEntry["legacyCustomName"];

/**
 * Stored types keyed by the camelCase name this repository's run event tables
 * use. `agUiSseEventTypes` and `conversationRunEventTypes` spread this object
 * so a new native type is declared in `NATIVE_RUN_EVENTS` and here, and
 * nowhere else.
 *
 * Written out rather than derived by case-converting `NATIVE_RUN_EVENTS`: a
 * derived object loses its literal key types, and the two tables that spread it
 * are consumed as `agUiSseEventTypes.toolCallStatusChanged`, which must stay a
 * checked property. The first case in this module's test pins the values to the
 * list in order, so the two cannot drift apart silently.
 */
export const nativeRunEventTypes = {
  toolCallStatusChanged: "TOOL_CALL_STATUS_CHANGED",
  inputRequestCreated: "INPUT_REQUEST_CREATED",
  inputRequestUpdated: "INPUT_REQUEST_UPDATED",
  childRunStatusChanged: "CHILD_RUN_STATUS_CHANGED",
  urlCited: "URL_CITED",
  documentCited: "DOCUMENT_CITED",
  fileAttached: "FILE_ATTACHED",
  runtimeEventRecorded: "RUNTIME_EVENT_RECORDED",
} as const;

/** Stored type for each native wire name, for SSE readers. */
export const nativeRunEventStoredTypesByWireName: ReadonlyMap<string, NativeRunEventStoredType> =
  new Map(NATIVE_RUN_EVENTS.map((entry) => [entry.wireName, entry.storedType]));

const NATIVE_LEGACY_NAMES: ReadonlySet<string> = new Set(
  NATIVE_RUN_EVENTS.map((entry) => entry.legacyCustomName),
);

/**
 * Reports whether a custom event name has a native replacement. Every
 * routing decision in this module goes through `buildNativeRunEventFrame`
 * returning null instead of calling this directly; it is exported for other
 * consumers of this module that need the same check without building a frame.
 */
export function isNativeRunEventName(name: string): name is NativeRunEventLegacyName {
  return NATIVE_LEGACY_NAMES.has(name);
}

const NATIVE_STORED_TYPES: ReadonlySet<string> = new Set(
  NATIVE_RUN_EVENTS.map((entry) => entry.storedType),
);

/**
 * Reports whether a durable event's `type` is one of the seven native record
 * types, each of which carries API-catalog-required fields beyond `type`.
 * Unlike `CUSTOM`, a native type cannot be summarized down to a generic
 * `{ type, note, summary }` shape without failing that validation.
 */
export function isNativeRunEventStoredType(type: string): type is NativeRunEventStoredType {
  return NATIVE_STORED_TYPES.has(type);
}

/** Live SSE frame: the AG-UI wire name and its payload. */
export interface NativeRunEventLiveShape {
  event: NativeRunEventWireName;
  payload: Record<string, unknown>;
}

/** Durable record: the same payload carrying its stored type. */
export type NativeRunEventDurableShape = Record<string, unknown> & {
  type: NativeRunEventStoredType;
};

/** The two emission shapes built from one payload. */
export interface NativeRunEventFrame {
  live: NativeRunEventLiveShape;
  durable: NativeRunEventDurableShape;
}

const TOOL_CALL_STATUS_CHANGED = NATIVE_RUN_EVENTS[0];
const INPUT_REQUEST_CREATED = NATIVE_RUN_EVENTS[1];
const INPUT_REQUEST_UPDATED = NATIVE_RUN_EVENTS[2];
const CHILD_RUN_STATUS_CHANGED = NATIVE_RUN_EVENTS[3];
const URL_CITED = NATIVE_RUN_EVENTS[4];
const DOCUMENT_CITED = NATIVE_RUN_EVENTS[5];
const FILE_ATTACHED = NATIVE_RUN_EVENTS[6];
const RUNTIME_EVENT_RECORDED = NATIVE_RUN_EVENTS[7];

// Keep application fields from overriding the native type or transport timing
// when an open custom value becomes a flat native payload.
//
// One payload feeds both shapes: the live wire frame is not just this
// repo's own chat client either, the API ingests the same SSE frame and
// stores it, so a value the append route would reject is exactly as unsafe
// there as it is in the durable record (I1). Builders that need to keep a
// citation/attachment renderable despite a dropped optional field do that on
// the read side (src/chat/ag-ui.ts's decoder), not by giving this frame two
// different payloads.
function toFrame(
  definition: NativeRunEventEntry,
  payload: Record<string, unknown>,
): NativeRunEventFrame {
  const { type: _type, elapsedMs: _elapsedMs, emittedAt: _emittedAt, ...nativePayload } = payload;
  return {
    live: { event: definition.wireName, payload: nativePayload },
    durable: { ...nativePayload, type: definition.storedType },
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Drop the listed keys from `rest` unless their value is a non-empty string.
 * The API catalog declares `title`/`filename`/`url` as
 * `z.string().min(1).optional()`, which accepts exactly two shapes: a
 * non-empty string, or the key absent entirely. An empty string fails the
 * length check; `null`, a number, an object, or anything else fails the type
 * check outright -- so every one of those needs dropping, not just the empty
 * string, unlike the required fields' own `readString` guard, which only
 * ever needs a fallback because it always has one to fall back to. Applied
 * to the one payload `toFrame` puts in both shapes; a builder that needs the
 * citation/attachment to still render when the dropped field made it
 * disappear restores that on the read side (src/chat/ag-ui.ts's decoder),
 * not by keeping an invalid value here.
 */
function omitInvalidOptionalStrings(
  rest: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...rest };
  for (const key of keys) {
    if (typeof result[key] !== "string" || result[key] === "") {
      delete result[key];
    }
  }
  return result;
}

/**
 * Fields the tool input status telemetry carries into a status change. The
 * index signature lets a legacy `tool-call-status` custom value's other
 * fields (`arguments`, `result`, `error`, `exitCode`, and the like) ride
 * through unchanged, the way `ChildRunStatusChangedInput` carries its value
 * through -- `applyToolCallStatusEvent` in `src/eval/agent-service.ts` still
 * reads those fields from this event.
 */
export interface ToolCallStatusChangedInput extends Record<string, unknown> {
  toolCallId: string;
  status: string;
  toolCallName?: string | null;
  parentMessageId?: string | null;
}

/** Build the tool call status change frames. */
export function buildToolCallStatusChangedEvent(
  input: ToolCallStatusChangedInput,
): NativeRunEventFrame {
  const { toolCallId, status, toolCallName, parentMessageId, ...rest } = input;
  const readParentMessageId = readString(parentMessageId);
  return toFrame(TOOL_CALL_STATUS_CHANGED, {
    ...rest,
    toolCallId,
    status,
    toolCallName: readString(toolCallName),
    ...(readParentMessageId ? { parentMessageId: readParentMessageId } : {}),
  });
}

/** Build the input request lifecycle frames. The action selects the type. */
export function buildInputRequestLifecycleEvent(input: {
  action: "created" | "updated";
  inputRequest: Record<string, unknown>;
}): NativeRunEventFrame {
  return toFrame(
    input.action === "created" ? INPUT_REQUEST_CREATED : INPUT_REQUEST_UPDATED,
    { inputRequest: input.inputRequest },
  );
}

/**
 * The child run lifecycle value. The index signature is deliberate: the value
 * is carried through unchanged, the way the API projector carries it, so a
 * field added to the lifecycle schema reaches the payload without a change
 * here.
 */
export type ChildRunStatusChangedInput = {
  toolCallId: string;
  childRunId: string;
  status: string;
} & Record<string, unknown>;

/** Build the child run status change frames. */
export function buildChildRunStatusChangedEvent(
  value: ChildRunStatusChangedInput,
): NativeRunEventFrame {
  return toFrame(CHILD_RUN_STATUS_CHANGED, { ...value });
}

/**
 * Build the URL citation frames from a `source-url` chunk.
 *
 * A chunk with no url yields an empty one, which the API catalog rejects as a
 * required field. `buildNativeRunEventFrame` guards that case and keeps the
 * `Custom` wrapper instead; a direct caller must do the same.
 *
 * A `title` the API catalog would reject -- an empty string, or any
 * non-string value -- is dropped from the one payload both shapes share, and
 * is not restored here. The chat decoder's UrlCited case falls back to the
 * citation's own resolved source id when title is absent, so the citation
 * still renders with something.
 */
export function buildUrlCitedEvent(source: Record<string, unknown>): NativeRunEventFrame {
  const { type: _type, ...rest } = source;
  const url = readString(rest.url) ?? "";
  const payload = {
    ...omitInvalidOptionalStrings(rest, ["title"]),
    url,
    sourceId: readString(rest.sourceId) ?? url,
  };
  return toFrame(URL_CITED, payload);
}

/**
 * Build the document citation frames from a `source-document` chunk.
 *
 * As with `buildUrlCitedEvent`, a chunk with no media type yields an empty one
 * that the API catalog rejects. Route through `buildNativeRunEventFrame`, which
 * guards it, rather than calling this directly with unvalidated input.
 *
 * A `title` or `filename` the API catalog would reject -- an empty string,
 * or any non-string value -- is dropped from the one payload both shapes
 * share, and is not restored here. `ChatSourceDocumentUiPart.title` is a
 * required chat UI field (unlike `filename`), so the chat decoder falls back
 * to the citation's source id when title is absent, the same way
 * `buildUrlCitedEvent`'s title falls back for its own decoder case; that
 * keeps the citation renderable without this builder needing to fake a
 * non-empty title into a payload the API also receives.
 */
export function buildDocumentCitedEvent(source: Record<string, unknown>): NativeRunEventFrame {
  const { type: _type, ...rest } = source;
  const mediaType = readString(rest.mediaType) ?? "";
  const payload = {
    ...omitInvalidOptionalStrings(rest, ["title", "filename"]),
    mediaType,
    sourceId: readString(rest.sourceId) ?? mediaType,
  };
  return toFrame(DOCUMENT_CITED, payload);
}

/**
 * Build the file attachment frames from a `file` chunk.
 *
 * The caller decides whether the chunk is a plain file: `buildNativeRunEventFrame`
 * rejects a `file-change` value, which the API projects to `FILES_CHANGED`.
 *
 * A `url` or `filename` the API catalog would reject -- an empty string, or
 * any non-string value -- is dropped from the one payload both shapes share,
 * and is not restored here. The chat decoder's FileAttached case treats a
 * missing url the same way the legacy `Custom` wrapper's
 * `toRenderableCustomChunk` always did: it falls back to a raw, unrenderable
 * data chunk rather than fabricating one, since unlike a title there is no
 * safe non-empty placeholder for a url -- a fake one would be an actively
 * misleading, possibly broken link.
 */
export function buildFileAttachedEvent(source: Record<string, unknown>): NativeRunEventFrame {
  const { type: _type, ...rest } = source;
  const payload = {
    ...omitInvalidOptionalStrings(rest, ["filename", "url"]),
    mediaType: readString(rest.mediaType) ?? "",
  };
  return toFrame(FILE_ATTACHED, payload);
}

/**
 * Fields the API catalog's `RUNTIME_EVENT_RECORDED` variant requires:
 * `runtime` and `kind` non-empty strings, `value` any JSON value but never
 * `undefined`. This is the catch-all diagnostics type for a runtime-native
 * event with no AG-UI equivalent (the API catalog's own description
 * mentions codex thread/session events as a future producer), so unlike the
 * other seven builders this one does not derive its shape from a fixed
 * source chunk -- the caller supplies the catalog fields directly.
 */
export interface RuntimeEventRecordedInput {
  runtime: string;
  kind: string;
  value: unknown;
}

/** Build the runtime event recorded frames. */
export function buildRuntimeEventRecordedEvent(
  input: RuntimeEventRecordedInput,
): NativeRunEventFrame {
  return toFrame(RUNTIME_EVENT_RECORDED, { ...input });
}

/** Routing input for one custom event name and its value. */
export interface NativeRunEventRoutingInput {
  name: string;
  value: unknown;
  parentMessageId?: string | null;
}

/**
 * Build the native frames for a legacy custom name, or null when the name has
 * no native replacement or the value cannot be read as its payload. A null
 * return is the caller's signal to keep the `Custom` wrapper, which is how
 * state snapshots, state deltas, and unknown names stay custom.
 */
export function buildNativeRunEventFrame(
  input: NativeRunEventRoutingInput,
): NativeRunEventFrame | null {
  const record = readRecord(input.value);
  if (!record) return null;

  switch (input.name) {
    case "tool-call-status": {
      const toolCallId = readString(record.toolCallId);
      const status = readString(record.status);
      if (!toolCallId || !status) return null;
      return buildToolCallStatusChangedEvent({
        ...record,
        toolCallId,
        status,
        toolCallName: readString(record.toolCallName),
        parentMessageId: input.parentMessageId ?? readString(record.parentMessageId),
      });
    }
    case "veryfront.input_request.lifecycle": {
      const action = record.action;
      const inputRequest = readRecord(record.inputRequest);
      if (action !== "created" && action !== "updated") return null;
      if (!inputRequest || !readString(inputRequest.id)) return null;
      return buildInputRequestLifecycleEvent({ action, inputRequest });
    }
    case "veryfront.invoke_agent.lifecycle": {
      const toolCallId = readString(record.toolCallId);
      const childRunId = readString(record.childRunId);
      const status = readString(record.status);
      if (!toolCallId || !childRunId || !status) return null;
      return buildChildRunStatusChangedEvent({ ...record, toolCallId, childRunId, status });
    }
    case "source-url":
      return readString(record.url) ? buildUrlCitedEvent(record) : null;
    case "source-document":
      return readString(record.mediaType) ? buildDocumentCitedEvent(record) : null;
    case "file":
      // The API projector routes a `file-change` value to FILES_CHANGED and
      // quarantines any other type, so a value that is not a plain file must
      // not become FileAttached here either. Nothing writes `file-change` in
      // this runtime today; the guard keeps the two sides twins anyway.
      return (record.type === "file" || record.type === undefined) &&
          readString(record.mediaType)
        ? buildFileAttachedEvent(record)
        : null;
    case "veryfront.runtime_context":
      // The one producer (runtime/index.ts's #streamWithinTurn) always sends
      // the whole AgentRunRuntimeContext snapshot as the chunk's `data`, so
      // `record` (already guarded non-null above) is the payload's `value`
      // field wholesale; `runtime`/`kind` are this producer's own constants,
      // not read off the value, since this legacy name only ever carried the
      // context object itself.
      return buildRuntimeEventRecordedEvent({
        runtime: "veryfront",
        kind: "runtime_context",
        value: record,
      });
    default:
      return null;
  }
}
