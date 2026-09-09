/**
 * Native run event vocabulary shared by every emission path.
 *
 * Veryfront Code used to wrap these seven occurrences in an AG-UI `Custom`
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

// `type` is written last so a payload that still carries a chunk type can
// never win over the stored type. No builder passes one through.
//
// `durablePayload` defaults to `livePayload` and only the three citation/file
// builders pass a distinct one: the API's batch append route rejects an
// empty-string `title`/`filename`/`url` outright (I1), so those builders drop
// it from the durable record, but the chat decoder in src/chat/ag-ui.ts uses
// a string `title` (DocumentCited) or `url` (FileAttached) -- empty string
// included -- as its gate for rendering the citation/attachment at all, so
// the live wire frame must keep the field exactly as the legacy `Custom`
// wrapper carried it.
function toFrame(
  definition: NativeRunEventEntry,
  livePayload: Record<string, unknown>,
  durablePayload: Record<string, unknown> = livePayload,
): NativeRunEventFrame {
  return {
    live: { event: definition.wireName, payload: livePayload },
    durable: { ...durablePayload, type: definition.storedType },
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
 * Drop the listed keys from `rest` when their value is an empty string, for
 * the durable payload only (see `toFrame`). The API catalog declares
 * `title`/`filename`/`url` as `z.string().min(1).optional()`, so an empty
 * string is a hard validation failure on the batch append route while an
 * absent key, `null`, or any other value is not -- only the empty-string
 * case needs dropping, never passed through like the required fields' own
 * `readString` guard.
 */
function omitEmptyStrings(
  rest: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...rest };
  for (const key of keys) {
    if (result[key] === "") {
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
 * `title` reaches the live wire frame exactly as the chunk carried it,
 * empty string included, since the chat decoder's UrlCited case renders the
 * citation regardless of title; the durable record drops an empty one
 * instead, since the API catalog rejects it there.
 */
export function buildUrlCitedEvent(source: Record<string, unknown>): NativeRunEventFrame {
  const { type: _type, ...rest } = source;
  const url = readString(rest.url) ?? "";
  const payload = { ...rest, url, sourceId: readString(rest.sourceId) ?? url };
  return toFrame(URL_CITED, payload, omitEmptyStrings(payload, ["title"]));
}

/**
 * Build the document citation frames from a `source-document` chunk.
 *
 * As with `buildUrlCitedEvent`, a chunk with no media type yields an empty one
 * that the API catalog rejects. Route through `buildNativeRunEventFrame`, which
 * guards it, rather than calling this directly with unvalidated input.
 *
 * `title` is never dropped, in either shape, unlike this event's own
 * `filename` or `buildUrlCitedEvent`'s `title`: `ChatSourceDocumentUiPart.title`
 * is a required chat UI field (not optional like its siblings), so the chat
 * decoder uses a string title as its gate for rendering the citation at all.
 * An empty title falls back to the source id instead -- the same value this
 * builder already falls back to when the chunk has no source id of its own
 * -- so the citation always has a renderable, API-valid title in both the
 * live frame and the durable record, with nothing for a later replay to
 * restore. `filename` reaches the live wire frame exactly as the chunk
 * carried it, empty string included, and the durable record drops an empty
 * one, since the API catalog rejects it there and the chat decoder never
 * gates rendering on it.
 */
export function buildDocumentCitedEvent(source: Record<string, unknown>): NativeRunEventFrame {
  const { type: _type, ...rest } = source;
  const mediaType = readString(rest.mediaType) ?? "";
  const sourceId = readString(rest.sourceId) ?? mediaType;
  const payload = { ...rest, mediaType, sourceId, title: readString(rest.title) ?? sourceId };
  return toFrame(DOCUMENT_CITED, payload, omitEmptyStrings(payload, ["filename"]));
}

/**
 * Build the file attachment frames from a `file` chunk.
 *
 * The caller decides whether the chunk is a plain file: `buildNativeRunEventFrame`
 * rejects a `file-change` value, which the API projects to `FILES_CHANGED`.
 *
 * `url`/`filename` reach the live wire frame exactly as the chunk carried
 * them, empty string included: the chat decoder's FileAttached case uses a
 * string `url` -- empty string included -- as its gate for rendering the
 * attachment at all, so dropping an empty one from the live frame would make
 * the attachment disappear instead of merely losing its url. The durable
 * record drops an empty url or filename instead, since the API catalog
 * rejects either there.
 *
 * Unlike `buildDocumentCitedEvent`'s title, `url` has no safe non-empty
 * fallback here -- a placeholder url would be an actively misleading,
 * possibly broken link -- so a chunk whose url was empty is, once stored,
 * indistinguishable on replay from one that never had a url at all: both
 * read back unrenderable. Known, accepted gap; the live frame still renders
 * it correctly the first time.
 */
export function buildFileAttachedEvent(source: Record<string, unknown>): NativeRunEventFrame {
  const { type: _type, ...rest } = source;
  const payload = { ...rest, mediaType: readString(rest.mediaType) ?? "" };
  return toFrame(FILE_ATTACHED, payload, omitEmptyStrings(payload, ["filename", "url"]));
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
    default:
      return null;
  }
}
