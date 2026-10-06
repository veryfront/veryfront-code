import {
  extensionFields,
  optionalNumber,
  requireLiteral,
  requireRecord,
  requireString,
  requireStringValue,
} from "#veryfront/events/ag-ui/native-profile-helpers.ts";
import { parseAgUiEvent, safeParseAgUiEvent } from "#veryfront/events/ag-ui/parser.ts";
import {
  AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_BY_TYPE,
  parseNativeSynchronizationRecord,
} from "#veryfront/events/ag-ui/native-synchronization-schemas.ts";
import type {
  AgUiNativeSynchronizationDataschema,
  AgUiNativeSynchronizationType,
} from "#veryfront/events/ag-ui/native-synchronization-schemas.ts";
export {
  AG_UI_NATIVE_SYNCHRONIZATION_JSON_SCHEMA,
  AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_BY_TYPE,
  AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_ID,
  AG_UI_NATIVE_SYNCHRONIZATION_TYPES,
  parseNativeSynchronizationRecord,
} from "#veryfront/events/ag-ui/native-synchronization-schemas.ts";
export type {
  AgUiNativeSynchronizationAnyRecord,
  AgUiNativeSynchronizationDataschema,
  AgUiNativeSynchronizationRecord,
  AgUiNativeSynchronizationType,
} from "#veryfront/events/ag-ui/native-synchronization-schemas.ts";
import type { AgUiEvent, AgUiEventOf } from "#veryfront/events/ag-ui/types.ts";

const AG_UI_PROTOCOL_NAME = "ag-ui";
const AG_UI_PROTOCOL_VERSION = "1.0";

export interface AgUiSynchronizationOccurrence {
  readonly source: string;
  readonly id: string;
}

export interface AgUiSynchronizationAttribution {
  readonly invocation?: {
    readonly subagentRunId: string;
  };
}

export interface AgUiSynchronizationProtocolMetadata {
  readonly name: typeof AG_UI_PROTOCOL_NAME;
  readonly version: typeof AG_UI_PROTOCOL_VERSION;
  readonly eventType: AgUiSynchronizationSupportedEvent["type"];
  readonly timestamp?: number;
  readonly rawEvent?: unknown;
  readonly metadata?: AgUiEvent["metadata"];
  readonly extensions?: Record<string, unknown>;
  readonly attribution?: AgUiSynchronizationAttribution;
}

export type AgUiSynchronizationSupportedEvent =
  | AgUiEventOf<"STATE_SNAPSHOT">
  | AgUiEventOf<"STATE_DELTA">
  | AgUiEventOf<"MESSAGES_SNAPSHOT">
  | AgUiEventOf<"ACTIVITY_SNAPSHOT">
  | AgUiEventOf<"ACTIVITY_DELTA">;

type AgUiSynchronizationStateSnapshotPayload = {
  readonly state: {
    readonly snapshot: AgUiEventOf<"STATE_SNAPSHOT">["snapshot"];
  };
  readonly protocol: {
    readonly agui: AgUiSynchronizationProtocolMetadata & { readonly eventType: "STATE_SNAPSHOT" };
  };
};

type AgUiSynchronizationStateDeltaPayload = {
  readonly state: {
    readonly delta: AgUiEventOf<"STATE_DELTA">["delta"];
  };
  readonly protocol: {
    readonly agui: AgUiSynchronizationProtocolMetadata & { readonly eventType: "STATE_DELTA" };
  };
};

type AgUiSynchronizationTranscriptSnapshotPayload = {
  readonly transcript: {
    readonly messages: AgUiEventOf<"MESSAGES_SNAPSHOT">["messages"];
  };
  readonly protocol: {
    readonly agui: AgUiSynchronizationProtocolMetadata & {
      readonly eventType: "MESSAGES_SNAPSHOT";
    };
  };
};

type AgUiSynchronizationActivitySnapshotPayload = {
  readonly activity: {
    readonly messageId: AgUiEventOf<"ACTIVITY_SNAPSHOT">["messageId"];
    readonly activityType: AgUiEventOf<"ACTIVITY_SNAPSHOT">["activityType"];
    readonly content: AgUiEventOf<"ACTIVITY_SNAPSHOT">["content"];
    readonly replace?: AgUiEventOf<"ACTIVITY_SNAPSHOT">["replace"];
  };
  readonly protocol: {
    readonly agui: AgUiSynchronizationProtocolMetadata & {
      readonly eventType: "ACTIVITY_SNAPSHOT";
    };
  };
};

type AgUiSynchronizationActivityDeltaPayload = {
  readonly activity: {
    readonly messageId: AgUiEventOf<"ACTIVITY_DELTA">["messageId"];
    readonly activityType: AgUiEventOf<"ACTIVITY_DELTA">["activityType"];
    readonly patch: AgUiEventOf<"ACTIVITY_DELTA">["patch"];
  };
  readonly protocol: {
    readonly agui: AgUiSynchronizationProtocolMetadata & { readonly eventType: "ACTIVITY_DELTA" };
  };
};

export type AgUiNativeSynchronizationPayload =
  | AgUiSynchronizationStateSnapshotPayload
  | AgUiSynchronizationStateDeltaPayload
  | AgUiSynchronizationTranscriptSnapshotPayload
  | AgUiSynchronizationActivitySnapshotPayload
  | AgUiSynchronizationActivityDeltaPayload;

export type AgUiNativeSynchronizationEvent =
  | {
    readonly specversion: "1.0";
    readonly id: string;
    readonly source: string;
    readonly type: "com.veryfront.synchronization.state.snapshot.recorded";
    readonly dataschema: AgUiNativeSynchronizationDataschema<
      "com.veryfront.synchronization.state.snapshot.recorded"
    >;
    readonly datacontenttype: "application/json";
    readonly data: AgUiSynchronizationStateSnapshotPayload;
  }
  | {
    readonly specversion: "1.0";
    readonly id: string;
    readonly source: string;
    readonly type: "com.veryfront.synchronization.state.delta.recorded";
    readonly dataschema: AgUiNativeSynchronizationDataschema<
      "com.veryfront.synchronization.state.delta.recorded"
    >;
    readonly datacontenttype: "application/json";
    readonly data: AgUiSynchronizationStateDeltaPayload;
  }
  | {
    readonly specversion: "1.0";
    readonly id: string;
    readonly source: string;
    readonly type: "com.veryfront.synchronization.transcript.snapshot.recorded";
    readonly dataschema: AgUiNativeSynchronizationDataschema<
      "com.veryfront.synchronization.transcript.snapshot.recorded"
    >;
    readonly datacontenttype: "application/json";
    readonly data: AgUiSynchronizationTranscriptSnapshotPayload;
  }
  | {
    readonly specversion: "1.0";
    readonly id: string;
    readonly source: string;
    readonly type: "com.veryfront.synchronization.activity.snapshot.recorded";
    readonly dataschema: AgUiNativeSynchronizationDataschema<
      "com.veryfront.synchronization.activity.snapshot.recorded"
    >;
    readonly datacontenttype: "application/json";
    readonly data: AgUiSynchronizationActivitySnapshotPayload;
  }
  | {
    readonly specversion: "1.0";
    readonly id: string;
    readonly source: string;
    readonly type: "com.veryfront.synchronization.activity.delta.recorded";
    readonly dataschema: AgUiNativeSynchronizationDataschema<
      "com.veryfront.synchronization.activity.delta.recorded"
    >;
    readonly datacontenttype: "application/json";
    readonly data: AgUiSynchronizationActivityDeltaPayload;
  };

export interface AgUiGeneratedSynchronizationFrame {
  readonly kind: "generated-read-frame";
  readonly event: AgUiSynchronizationSupportedEvent;
  readonly protocol: {
    readonly agui: AgUiSynchronizationProtocolMetadata;
  };
}

export interface ProjectAgUiSynchronizationInput {
  readonly event: unknown;
  readonly occurrence: AgUiSynchronizationOccurrence;
}

export interface ProjectNativeSynchronizationInput {
  readonly event: unknown;
}

const STATE_SNAPSHOT_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "snapshot",
]);
const STATE_DELTA_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "delta",
]);
const MESSAGES_SNAPSHOT_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "messages",
]);
const ACTIVITY_SNAPSHOT_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "messageId",
  "activityType",
  "content",
  "replace",
]);
const ACTIVITY_DELTA_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "messageId",
  "activityType",
  "patch",
]);

function validateOccurrence(
  occurrence: AgUiSynchronizationOccurrence,
): AgUiSynchronizationOccurrence {
  return {
    source: requireString(occurrence.source, "synchronization occurrence source"),
    id: requireString(occurrence.id, "synchronization occurrence id"),
  };
}

type AgUiProtocolBaseMetadata = Omit<AgUiSynchronizationProtocolMetadata, "eventType">;

function protocolBaseMetadata(
  event: AgUiSynchronizationSupportedEvent,
  knownFields: ReadonlySet<string>,
): AgUiProtocolBaseMetadata {
  const attribution: AgUiSynchronizationAttribution | undefined = event.subagentRunId === undefined
    ? undefined
    : { invocation: { subagentRunId: event.subagentRunId } };
  const extensions = extensionFields(event, knownFields);
  return {
    name: AG_UI_PROTOCOL_NAME,
    version: AG_UI_PROTOCOL_VERSION,
    ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
    ...(event.rawEvent === undefined ? {} : { rawEvent: event.rawEvent }),
    ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
    ...(extensions === undefined ? {} : { extensions }),
    ...(attribution === undefined ? {} : { attribution }),
  };
}

function protocolMetadata(
  event: AgUiSynchronizationSupportedEvent,
  knownFields: ReadonlySet<string>,
): AgUiSynchronizationProtocolMetadata {
  switch (event.type) {
    case "STATE_SNAPSHOT":
      return { ...protocolBaseMetadata(event, knownFields), eventType: "STATE_SNAPSHOT" };
    case "STATE_DELTA":
      return { ...protocolBaseMetadata(event, knownFields), eventType: "STATE_DELTA" };
    case "MESSAGES_SNAPSHOT":
      return { ...protocolBaseMetadata(event, knownFields), eventType: "MESSAGES_SNAPSHOT" };
    case "ACTIVITY_SNAPSHOT":
      return { ...protocolBaseMetadata(event, knownFields), eventType: "ACTIVITY_SNAPSHOT" };
    case "ACTIVITY_DELTA":
      return { ...protocolBaseMetadata(event, knownFields), eventType: "ACTIVITY_DELTA" };
  }
}

function validateNativeSynchronizationEvent<TEvent extends AgUiNativeSynchronizationEvent>(
  event: TEvent,
): TEvent {
  parseNativeSynchronizationRecord(event);
  return event;
}

function supportedAgUiEvent(input: unknown): AgUiSynchronizationSupportedEvent {
  const event = parseAgUiEvent(input);
  switch (event.type) {
    case "STATE_SNAPSHOT":
    case "STATE_DELTA":
    case "MESSAGES_SNAPSHOT":
    case "ACTIVITY_SNAPSHOT":
    case "ACTIVITY_DELTA":
      return event;
    default:
      throw new TypeError(`${event.type} is not an AG-UI synchronization event`);
  }
}

export function projectAgUiSynchronizationEvent(
  input: ProjectAgUiSynchronizationInput,
): AgUiNativeSynchronizationEvent {
  const event = supportedAgUiEvent(input.event);
  const occurrence = validateOccurrence(input.occurrence);
  switch (event.type) {
    case "STATE_SNAPSHOT": {
      const nativeEvent: AgUiNativeSynchronizationEvent = {
        specversion: "1.0",
        id: occurrence.id,
        source: occurrence.source,
        type: "com.veryfront.synchronization.state.snapshot.recorded",
        dataschema: AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_BY_TYPE[
          "com.veryfront.synchronization.state.snapshot.recorded"
        ],
        datacontenttype: "application/json",
        data: {
          state: { snapshot: event.snapshot },
          protocol: {
            agui: {
              ...protocolBaseMetadata(event, STATE_SNAPSHOT_FIELDS),
              eventType: "STATE_SNAPSHOT",
            },
          },
        },
      };
      return validateNativeSynchronizationEvent(nativeEvent);
    }
    case "STATE_DELTA": {
      const nativeEvent: AgUiNativeSynchronizationEvent = {
        specversion: "1.0",
        id: occurrence.id,
        source: occurrence.source,
        type: "com.veryfront.synchronization.state.delta.recorded",
        dataschema: AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_BY_TYPE[
          "com.veryfront.synchronization.state.delta.recorded"
        ],
        datacontenttype: "application/json",
        data: {
          state: { delta: event.delta },
          protocol: {
            agui: { ...protocolBaseMetadata(event, STATE_DELTA_FIELDS), eventType: "STATE_DELTA" },
          },
        },
      };
      return validateNativeSynchronizationEvent(nativeEvent);
    }
    case "MESSAGES_SNAPSHOT": {
      const nativeEvent: AgUiNativeSynchronizationEvent = {
        specversion: "1.0",
        id: occurrence.id,
        source: occurrence.source,
        type: "com.veryfront.synchronization.transcript.snapshot.recorded",
        dataschema: AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_BY_TYPE[
          "com.veryfront.synchronization.transcript.snapshot.recorded"
        ],
        datacontenttype: "application/json",
        data: {
          transcript: { messages: event.messages },
          protocol: {
            agui: {
              ...protocolBaseMetadata(event, MESSAGES_SNAPSHOT_FIELDS),
              eventType: "MESSAGES_SNAPSHOT",
            },
          },
        },
      };
      return validateNativeSynchronizationEvent(nativeEvent);
    }
    case "ACTIVITY_SNAPSHOT": {
      const nativeEvent: AgUiNativeSynchronizationEvent = {
        specversion: "1.0",
        id: occurrence.id,
        source: occurrence.source,
        type: "com.veryfront.synchronization.activity.snapshot.recorded",
        dataschema: AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_BY_TYPE[
          "com.veryfront.synchronization.activity.snapshot.recorded"
        ],
        datacontenttype: "application/json",
        data: {
          activity: {
            messageId: event.messageId,
            activityType: event.activityType,
            content: event.content,
            ...(event.replace === undefined ? {} : { replace: event.replace }),
          },
          protocol: {
            agui: {
              ...protocolBaseMetadata(event, ACTIVITY_SNAPSHOT_FIELDS),
              eventType: "ACTIVITY_SNAPSHOT",
            },
          },
        },
      };
      return validateNativeSynchronizationEvent(nativeEvent);
    }
    case "ACTIVITY_DELTA": {
      const nativeEvent: AgUiNativeSynchronizationEvent = {
        specversion: "1.0",
        id: occurrence.id,
        source: occurrence.source,
        type: "com.veryfront.synchronization.activity.delta.recorded",
        dataschema: AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_BY_TYPE[
          "com.veryfront.synchronization.activity.delta.recorded"
        ],
        datacontenttype: "application/json",
        data: {
          activity: {
            messageId: event.messageId,
            activityType: event.activityType,
            patch: event.patch,
          },
          protocol: {
            agui: {
              ...protocolBaseMetadata(event, ACTIVITY_DELTA_FIELDS),
              eventType: "ACTIVITY_DELTA",
            },
          },
        },
      };
      return validateNativeSynchronizationEvent(nativeEvent);
    }
  }
}

function aguiProtocol(value: unknown): AgUiSynchronizationProtocolMetadata {
  const protocol = requireRecord(value, "protocol");
  const agui = requireRecord(protocol.agui, "protocol.agui");
  requireLiteral(agui.name, AG_UI_PROTOCOL_NAME, "protocol.agui.name");
  requireLiteral(agui.version, AG_UI_PROTOCOL_VERSION, "protocol.agui.version");
  return aguiProtocolFromRecord(agui);
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  return requireRecord(value, label);
}

function optionalAttribution(value: unknown): AgUiSynchronizationAttribution | undefined {
  const attribution = optionalRecord(value, "protocol.agui.attribution");
  if (attribution === undefined) return undefined;
  const invocation = optionalRecord(attribution.invocation, "protocol.agui.attribution.invocation");
  if (invocation === undefined) return {};
  return {
    invocation: {
      subagentRunId: requireStringValue(
        invocation.subagentRunId,
        "protocol.agui.attribution.invocation.subagentRunId",
      ),
    },
  };
}

function aguiProtocolBaseFromRecord(record: Record<string, unknown>): AgUiProtocolBaseMetadata {
  return {
    name: AG_UI_PROTOCOL_NAME,
    version: AG_UI_PROTOCOL_VERSION,
    ...(record.timestamp === undefined
      ? {}
      : { timestamp: optionalNumber(record.timestamp, "protocol.agui.timestamp") }),
    ...(record.rawEvent === undefined ? {} : { rawEvent: record.rawEvent }),
    ...(record.metadata === undefined
      ? {}
      : { metadata: requireRecord(record.metadata, "protocol.agui.metadata") }),
    ...(record.extensions === undefined
      ? {}
      : { extensions: requireRecord(record.extensions, "protocol.agui.extensions") }),
    ...(record.attribution === undefined
      ? {}
      : { attribution: optionalAttribution(record.attribution) }),
  };
}

function aguiProtocolFromRecord(
  record: Record<string, unknown>,
): AgUiSynchronizationProtocolMetadata {
  const eventType = requireString(record.eventType, "protocol.agui.eventType");
  switch (eventType) {
    case "STATE_SNAPSHOT":
      return { ...aguiProtocolBaseFromRecord(record), eventType: "STATE_SNAPSHOT" };
    case "STATE_DELTA":
      return { ...aguiProtocolBaseFromRecord(record), eventType: "STATE_DELTA" };
    case "MESSAGES_SNAPSHOT":
      return { ...aguiProtocolBaseFromRecord(record), eventType: "MESSAGES_SNAPSHOT" };
    case "ACTIVITY_SNAPSHOT":
      return { ...aguiProtocolBaseFromRecord(record), eventType: "ACTIVITY_SNAPSHOT" };
    case "ACTIVITY_DELTA":
      return { ...aguiProtocolBaseFromRecord(record), eventType: "ACTIVITY_DELTA" };
    default:
      throw new TypeError(`Unsupported protocol.agui.eventType: ${eventType}`);
  }
}

function requireExtensionFields(
  protocol: AgUiSynchronizationProtocolMetadata,
  knownFields: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const extensions = protocol.extensions;
  if (extensions === undefined) return undefined;
  for (const key of Object.keys(extensions)) {
    if (knownFields.has(key)) {
      throw new TypeError(`protocol.agui.extensions must not contain reserved AG-UI field ${key}`);
    }
  }
  return extensions;
}

function eventBase(
  protocol: AgUiSynchronizationProtocolMetadata,
  knownFields: ReadonlySet<string>,
): Record<string, unknown> {
  const invocation = protocol.attribution?.invocation;
  return {
    ...(requireExtensionFields(protocol, knownFields) ?? {}),
    type: protocol.eventType,
    ...(protocol.timestamp === undefined ? {} : { timestamp: protocol.timestamp }),
    ...(protocol.rawEvent === undefined ? {} : { rawEvent: protocol.rawEvent }),
    ...(protocol.metadata === undefined ? {} : { metadata: protocol.metadata }),
    ...(invocation === undefined ? {} : { subagentRunId: invocation.subagentRunId }),
  };
}

function validateProjectedAgUi(event: Record<string, unknown>): AgUiSynchronizationSupportedEvent {
  const result = safeParseAgUiEvent(event);
  if (!result.success) {
    throw new TypeError(result.issues[0]?.message ?? "Invalid AG-UI synchronization event");
  }
  return supportedAgUiEvent(result.data);
}

function projectStateSnapshot(data: Record<string, unknown>): AgUiSynchronizationSupportedEvent {
  const protocol = aguiProtocol(data.protocol);
  requireLiteral(protocol.eventType, "STATE_SNAPSHOT", "protocol.agui.eventType");
  const state = requireRecord(data.state, "state");
  return validateProjectedAgUi({
    ...eventBase(protocol, STATE_SNAPSHOT_FIELDS),
    snapshot: state.snapshot,
  });
}

function projectStateDelta(data: Record<string, unknown>): AgUiSynchronizationSupportedEvent {
  const protocol = aguiProtocol(data.protocol);
  requireLiteral(protocol.eventType, "STATE_DELTA", "protocol.agui.eventType");
  const state = requireRecord(data.state, "state");
  return validateProjectedAgUi({ ...eventBase(protocol, STATE_DELTA_FIELDS), delta: state.delta });
}

function projectTranscriptSnapshot(
  data: Record<string, unknown>,
): AgUiSynchronizationSupportedEvent {
  const protocol = aguiProtocol(data.protocol);
  requireLiteral(protocol.eventType, "MESSAGES_SNAPSHOT", "protocol.agui.eventType");
  const transcript = requireRecord(data.transcript, "transcript");
  return validateProjectedAgUi({
    ...eventBase(protocol, MESSAGES_SNAPSHOT_FIELDS),
    messages: transcript.messages,
  });
}

function projectActivitySnapshot(data: Record<string, unknown>): AgUiSynchronizationSupportedEvent {
  const protocol = aguiProtocol(data.protocol);
  requireLiteral(protocol.eventType, "ACTIVITY_SNAPSHOT", "protocol.agui.eventType");
  const activity = requireRecord(data.activity, "activity");
  return validateProjectedAgUi({
    ...eventBase(protocol, ACTIVITY_SNAPSHOT_FIELDS),
    messageId: activity.messageId,
    activityType: activity.activityType,
    content: activity.content,
    ...(activity.replace === undefined ? {} : { replace: activity.replace }),
  });
}

function projectActivityDelta(data: Record<string, unknown>): AgUiSynchronizationSupportedEvent {
  const protocol = aguiProtocol(data.protocol);
  requireLiteral(protocol.eventType, "ACTIVITY_DELTA", "protocol.agui.eventType");
  const activity = requireRecord(data.activity, "activity");
  return validateProjectedAgUi({
    ...eventBase(protocol, ACTIVITY_DELTA_FIELDS),
    messageId: activity.messageId,
    activityType: activity.activityType,
    patch: activity.patch,
  });
}

export function parseNativeSynchronizationEvent(input: unknown): AgUiNativeSynchronizationEvent {
  const record = parseNativeSynchronizationRecord(input);
  const occurrence = { source: record.source, id: record.id };
  const agui = projectNativeSynchronizationByType(record.type, record.data);
  const canonical = projectAgUiSynchronizationEvent({ event: agui, occurrence });
  if (canonical.type !== record.type) {
    throw new TypeError(`${record.type} does not match protocol.agui.eventType`);
  }
  return canonical;
}

function projectNativeSynchronizationByType(
  type: AgUiNativeSynchronizationType,
  data: Record<string, unknown>,
): AgUiSynchronizationSupportedEvent {
  switch (type) {
    case "com.veryfront.synchronization.state.snapshot.recorded":
      return projectStateSnapshot(data);
    case "com.veryfront.synchronization.state.delta.recorded":
      return projectStateDelta(data);
    case "com.veryfront.synchronization.transcript.snapshot.recorded":
      return projectTranscriptSnapshot(data);
    case "com.veryfront.synchronization.activity.snapshot.recorded":
      return projectActivitySnapshot(data);
    case "com.veryfront.synchronization.activity.delta.recorded":
      return projectActivityDelta(data);
  }
}

export function projectNativeSynchronizationEvent(
  input: ProjectNativeSynchronizationInput,
): AgUiSynchronizationSupportedEvent {
  const event = parseNativeSynchronizationEvent(input.event);
  return projectNativeSynchronizationByType(event.type, event.data);
}

export function createGeneratedSynchronizationFrame(
  event: unknown,
): AgUiGeneratedSynchronizationFrame {
  const agui = supportedAgUiEvent(event);
  return {
    kind: "generated-read-frame",
    event: agui,
    protocol: { agui: protocolMetadata(agui, knownFieldsFor(agui)) },
  };
}

function knownFieldsFor(event: AgUiSynchronizationSupportedEvent): ReadonlySet<string> {
  switch (event.type) {
    case "STATE_SNAPSHOT":
      return STATE_SNAPSHOT_FIELDS;
    case "STATE_DELTA":
      return STATE_DELTA_FIELDS;
    case "MESSAGES_SNAPSHOT":
      return MESSAGES_SNAPSHOT_FIELDS;
    case "ACTIVITY_SNAPSHOT":
      return ACTIVITY_SNAPSHOT_FIELDS;
    case "ACTIVITY_DELTA":
      return ACTIVITY_DELTA_FIELDS;
  }
}
