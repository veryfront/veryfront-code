import {
  createNativeTypeGenerator,
  writeGeneratedTypes,
} from "#veryfront/events/ag-ui/generator.ts";
import { AG_UI_NATIVE_REASONING_RECORD_SCHEMA } from "#veryfront/events/ag-ui/native-reasoning-contract.ts";

const OUTPUT_PATH = new URL("./native-reasoning-types.generated.ts", import.meta.url);

const PATH_TYPE_ALIASES = new Map<string, string>([
  ["ReasoningContextStarted.context.messageId", 'AgUiEventOf<"REASONING_START">["messageId"]'],
  ["ReasoningContextEnded.context.messageId", 'AgUiEventOf<"REASONING_END">["messageId"]'],
  [
    "ReasoningContinuationRecorded.continuation.subtype",
    'AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["subtype"]',
  ],
  [
    "ReasoningContinuationRecorded.continuation.entityId",
    'AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["entityId"]',
  ],
  [
    "ReasoningContinuationRecorded.continuation.encryptedValue",
    'AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["encryptedValue"]',
  ],
  ["ReasoningContextStarted.protocol.agui.timestamp", "number"],
  ["ReasoningContextEnded.protocol.agui.timestamp", "number"],
  ["ReasoningContinuationRecorded.protocol.agui.timestamp", "number"],
  ["ReasoningContextStarted.protocol.agui.rawEvent", 'AgUiEventOf<"REASONING_START">["rawEvent"]'],
  ["ReasoningContextEnded.protocol.agui.rawEvent", 'AgUiEventOf<"REASONING_END">["rawEvent"]'],
  [
    "ReasoningContinuationRecorded.protocol.agui.rawEvent",
    'AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["rawEvent"]',
  ],
  ["ReasoningContextStarted.protocol.agui.metadata", 'AgUiEventOf<"REASONING_START">["metadata"]'],
  ["ReasoningContextEnded.protocol.agui.metadata", 'AgUiEventOf<"REASONING_END">["metadata"]'],
  [
    "ReasoningContinuationRecorded.protocol.agui.metadata",
    'AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["metadata"]',
  ],
  ["ReasoningContextStarted.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["ReasoningContextEnded.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["ReasoningContinuationRecorded.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
]);

const { recordSource } = createNativeTypeGenerator({
  recordSchema: AG_UI_NATIVE_REASONING_RECORD_SCHEMA,
  pathAliases: PATH_TYPE_ALIASES,
  label: "native reasoning",
});

function generatedSource(): string {
  return recordSource({
    name: "Reasoning",
    profile: "reasoning",
    schemaName: "AG_UI_NATIVE_REASONING_RECORD_SCHEMA",
  });
}

await writeGeneratedTypes({
  source: generatedSource(),
  outputPath: OUTPUT_PATH,
  tempPrefix: "ag-ui-native-sync-types-",
  outdatedMessages: [
    "Generated native reasoning types are out of date. Run:",
    "  deno run -A src/events/ag-ui/generate-native-reasoning-types.ts",
  ],
});
