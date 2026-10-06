import {
  createNativeTypeGenerator,
  writeGeneratedTypes,
} from "#veryfront/events/ag-ui/generator.ts";
import { AG_UI_NATIVE_SIGNAL_RECORD_SCHEMA } from "#veryfront/events/ag-ui/native-signal-contract.ts";

const OUTPUT_PATH = new URL("./native-signal-types.generated.ts", import.meta.url);

const PATH_TYPE_ALIASES = new Map<string, string>([
  ["RawSignalRecorded.signal.event", 'AgUiEventOf<"RAW">["event"]'],
  ["RawSignalRecorded.signal.source", 'AgUiEventOf<"RAW">["source"]'],
  ["CustomSignalRecorded.signal.name", 'AgUiEventOf<"CUSTOM">["name"]'],
  ["CustomSignalRecorded.signal.value", 'AgUiEventOf<"CUSTOM">["value"]'],
  ["RawSignalRecorded.protocol.agui.timestamp", "number"],
  ["CustomSignalRecorded.protocol.agui.timestamp", "number"],
  ["RawSignalRecorded.protocol.agui.rawEvent", 'AgUiEventOf<"RAW">["rawEvent"]'],
  ["CustomSignalRecorded.protocol.agui.rawEvent", 'AgUiEventOf<"CUSTOM">["rawEvent"]'],
  ["RawSignalRecorded.protocol.agui.metadata", 'AgUiEventOf<"RAW">["metadata"]'],
  ["CustomSignalRecorded.protocol.agui.metadata", 'AgUiEventOf<"CUSTOM">["metadata"]'],
  ["RawSignalRecorded.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["CustomSignalRecorded.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
]);

const { recordSource } = createNativeTypeGenerator({
  recordSchema: AG_UI_NATIVE_SIGNAL_RECORD_SCHEMA,
  pathAliases: PATH_TYPE_ALIASES,
  label: "native signal",
});

function generatedSource(): string {
  return recordSource({
    name: "Signal",
    profile: "signal",
    schemaName: "AG_UI_NATIVE_SIGNAL_RECORD_SCHEMA",
  });
}

await writeGeneratedTypes({
  source: generatedSource(),
  outputPath: OUTPUT_PATH,
  tempPrefix: "ag-ui-native-signal-types-",
  outdatedMessages: [
    "Generated native signal types are out of date. Run:",
    "  deno run -A src/events/ag-ui/generate-native-signal-types.ts",
  ],
});
