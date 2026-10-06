import {
  createNativeTypeGenerator,
  writeGeneratedTypes,
} from "#veryfront/events/ag-ui/generator.ts";
import { AG_UI_NATIVE_INVOCATION_RECORD_SCHEMA } from "#veryfront/events/ag-ui/native-invocation-contract.ts";

const OUTPUT_PATH = new URL("./native-invocation-types.generated.ts", import.meta.url);

const PATH_TYPE_ALIASES = new Map<string, string>([
  [
    "InvocationStarted.invocation.subagentRunId",
    'AgUiEventOf<"SUBAGENT_STARTED">["subagentRunId"]',
  ],
  ["InvocationStarted.invocation.name", 'AgUiEventOf<"SUBAGENT_STARTED">["name"]'],
  ["InvocationStarted.invocation.description", 'AgUiEventOf<"SUBAGENT_STARTED">["description"]'],
  [
    "InvocationSucceeded.invocation.subagentRunId",
    'AgUiEventOf<"SUBAGENT_FINISHED">["subagentRunId"]',
  ],
  ["InvocationSucceeded.invocation.result", 'AgUiEventOf<"SUBAGENT_FINISHED">["result"]'],
  [
    "InvocationSucceeded.invocation.outcome",
    'Extract<NonNullable<AgUiEventOf<"SUBAGENT_FINISHED">["outcome"]>, { readonly type: "success" }>',
  ],
  [
    "InvocationPaused.invocation.subagentRunId",
    'AgUiEventOf<"SUBAGENT_FINISHED">["subagentRunId"]',
  ],
  ["InvocationPaused.invocation.result", 'AgUiEventOf<"SUBAGENT_FINISHED">["result"]'],
  [
    "InvocationPaused.invocation.outcome",
    'Extract<NonNullable<AgUiEventOf<"SUBAGENT_FINISHED">["outcome"]>, { readonly type: "suspended" }>',
  ],
  ["InvocationFailed.invocation.subagentRunId", 'AgUiEventOf<"SUBAGENT_ERROR">["subagentRunId"]'],
  ["InvocationFailed.invocation.message", 'AgUiEventOf<"SUBAGENT_ERROR">["message"]'],
  ["InvocationFailed.invocation.code", 'AgUiEventOf<"SUBAGENT_ERROR">["code"]'],
  ["InvocationStarted.protocol.agui.timestamp", "number"],
  ["InvocationSucceeded.protocol.agui.timestamp", "number"],
  ["InvocationPaused.protocol.agui.timestamp", "number"],
  ["InvocationFailed.protocol.agui.timestamp", "number"],
  ["InvocationStarted.protocol.agui.rawEvent", 'AgUiEventOf<"SUBAGENT_STARTED">["rawEvent"]'],
  ["InvocationSucceeded.protocol.agui.rawEvent", 'AgUiEventOf<"SUBAGENT_FINISHED">["rawEvent"]'],
  ["InvocationPaused.protocol.agui.rawEvent", 'AgUiEventOf<"SUBAGENT_FINISHED">["rawEvent"]'],
  ["InvocationFailed.protocol.agui.rawEvent", 'AgUiEventOf<"SUBAGENT_ERROR">["rawEvent"]'],
  ["InvocationStarted.protocol.agui.metadata", 'AgUiEventOf<"SUBAGENT_STARTED">["metadata"]'],
  ["InvocationSucceeded.protocol.agui.metadata", 'AgUiEventOf<"SUBAGENT_FINISHED">["metadata"]'],
  ["InvocationPaused.protocol.agui.metadata", 'AgUiEventOf<"SUBAGENT_FINISHED">["metadata"]'],
  ["InvocationFailed.protocol.agui.metadata", 'AgUiEventOf<"SUBAGENT_ERROR">["metadata"]'],
  ["InvocationStarted.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["InvocationSucceeded.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["InvocationPaused.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["InvocationFailed.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
]);

const { recordSource } = createNativeTypeGenerator({
  recordSchema: AG_UI_NATIVE_INVOCATION_RECORD_SCHEMA,
  pathAliases: PATH_TYPE_ALIASES,
  label: "native invocation",
});

function generatedSource(): string {
  return recordSource({
    name: "Invocation",
    profile: "invocation",
    schemaName: "AG_UI_NATIVE_INVOCATION_RECORD_SCHEMA",
    attributionLines: [
      "export interface AgUiInvocationParentAttribution {",
      "  readonly parent?: {",
      "    readonly invocation?: { readonly subagentRunId: string };",
      "    readonly tool?: { readonly toolCallId: string };",
      "    readonly message?: { readonly messageId: string };",
      "  };",
      "}",
      "",
    ],
  });
}

await writeGeneratedTypes({
  source: generatedSource(),
  outputPath: OUTPUT_PATH,
  tempPrefix: "ag-ui-native-invocation-types-",
  outdatedMessages: [
    "Generated native invocation types are out of date. Run:",
    "  deno run -A src/events/ag-ui/generate-native-invocation-types.ts",
  ],
});
