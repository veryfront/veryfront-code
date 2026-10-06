import {
  createNativeTypeGenerator,
  writeGeneratedTypes,
} from "#veryfront/events/ag-ui/generator.ts";
import { AG_UI_NATIVE_SYNCHRONIZATION_RECORD_SCHEMA } from "#veryfront/events/ag-ui/native-synchronization-contract.ts";

const OUTPUT_PATH = new URL("./native-synchronization-types.generated.ts", import.meta.url);

const PATH_TYPE_ALIASES = new Map<string, string>([
  ["StateSnapshotRecorded.state.snapshot", 'AgUiEventOf<"STATE_SNAPSHOT">["snapshot"]'],
  ["StateDeltaRecorded.state.delta", 'AgUiEventOf<"STATE_DELTA">["delta"]'],
  [
    "TranscriptSnapshotRecorded.transcript.messages",
    'AgUiEventOf<"MESSAGES_SNAPSHOT">["messages"]',
  ],
  ["ActivitySnapshotRecorded.activity.messageId", 'AgUiEventOf<"ACTIVITY_SNAPSHOT">["messageId"]'],
  [
    "ActivitySnapshotRecorded.activity.activityType",
    'AgUiEventOf<"ACTIVITY_SNAPSHOT">["activityType"]',
  ],
  ["ActivitySnapshotRecorded.activity.content", 'AgUiEventOf<"ACTIVITY_SNAPSHOT">["content"]'],
  ["ActivitySnapshotRecorded.activity.replace", 'AgUiEventOf<"ACTIVITY_SNAPSHOT">["replace"]'],
  ["ActivityDeltaRecorded.activity.messageId", 'AgUiEventOf<"ACTIVITY_DELTA">["messageId"]'],
  ["ActivityDeltaRecorded.activity.activityType", 'AgUiEventOf<"ACTIVITY_DELTA">["activityType"]'],
  ["ActivityDeltaRecorded.activity.patch", 'AgUiEventOf<"ACTIVITY_DELTA">["patch"]'],
  ["StateSnapshotRecorded.protocol.agui.timestamp", "number"],
  ["StateDeltaRecorded.protocol.agui.timestamp", "number"],
  ["TranscriptSnapshotRecorded.protocol.agui.timestamp", "number"],
  ["ActivitySnapshotRecorded.protocol.agui.timestamp", "number"],
  ["ActivityDeltaRecorded.protocol.agui.timestamp", "number"],
  ["StateSnapshotRecorded.protocol.agui.rawEvent", 'AgUiEventOf<"STATE_SNAPSHOT">["rawEvent"]'],
  ["StateDeltaRecorded.protocol.agui.rawEvent", 'AgUiEventOf<"STATE_DELTA">["rawEvent"]'],
  [
    "TranscriptSnapshotRecorded.protocol.agui.rawEvent",
    'AgUiEventOf<"MESSAGES_SNAPSHOT">["rawEvent"]',
  ],
  [
    "ActivitySnapshotRecorded.protocol.agui.rawEvent",
    'AgUiEventOf<"ACTIVITY_SNAPSHOT">["rawEvent"]',
  ],
  ["ActivityDeltaRecorded.protocol.agui.rawEvent", 'AgUiEventOf<"ACTIVITY_DELTA">["rawEvent"]'],
  ["StateSnapshotRecorded.protocol.agui.metadata", 'AgUiEventOf<"STATE_SNAPSHOT">["metadata"]'],
  ["StateDeltaRecorded.protocol.agui.metadata", 'AgUiEventOf<"STATE_DELTA">["metadata"]'],
  [
    "TranscriptSnapshotRecorded.protocol.agui.metadata",
    'AgUiEventOf<"MESSAGES_SNAPSHOT">["metadata"]',
  ],
  [
    "ActivitySnapshotRecorded.protocol.agui.metadata",
    'AgUiEventOf<"ACTIVITY_SNAPSHOT">["metadata"]',
  ],
  ["ActivityDeltaRecorded.protocol.agui.metadata", 'AgUiEventOf<"ACTIVITY_DELTA">["metadata"]'],
  ["StateSnapshotRecorded.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["StateDeltaRecorded.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["TranscriptSnapshotRecorded.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["ActivitySnapshotRecorded.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["ActivityDeltaRecorded.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
]);

const { recordSource } = createNativeTypeGenerator({
  recordSchema: AG_UI_NATIVE_SYNCHRONIZATION_RECORD_SCHEMA,
  pathAliases: PATH_TYPE_ALIASES,
  label: "native synchronization",
});

function generatedSource(): string {
  return recordSource({
    name: "Synchronization",
    profile: "synchronization",
    schemaName: "AG_UI_NATIVE_SYNCHRONIZATION_RECORD_SCHEMA",
  });
}

await writeGeneratedTypes({
  source: generatedSource(),
  outputPath: OUTPUT_PATH,
  tempPrefix: "ag-ui-native-sync-types-",
  outdatedMessages: [
    "Generated native synchronization types are out of date. Run:",
    "  deno run -A src/events/ag-ui/generate-native-synchronization-types.ts",
  ],
});
