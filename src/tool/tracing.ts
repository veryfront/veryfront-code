import type { HostToolDefinition, HostToolSet } from "./host-tools.ts";
import type { ToolExecutionContext } from "./types.ts";
import {
  getEnumerableOwnStringDataEntries,
  getOwnDataProperty,
  isMissingOwnDataProperty,
  snapshotEnumerableOwnDataObject,
} from "./data-properties.ts";

/** Public API contract for host tool trace runner. */
export type HostToolTraceRunner = <TResult>(
  spanName: string,
  operation: () => TResult,
) => TResult;

/** Public API contract for host tool trace attributes. */
export type HostToolTraceAttributes = Record<string, unknown>;

/** Input payload for host tool trace attribute. */
export type HostToolTraceAttributeInput = {
  toolName: string;
  toolCallId: string | undefined;
  context: ToolExecutionContext | undefined;
};

/** Options accepted by trace host tools. */
export type TraceHostToolsOptions<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> = {
  trace: HostToolTraceRunner;
  buildAttributes?: (
    input: HostToolTraceAttributeInput,
  ) => TAttributes | undefined;
  setAttributes?: (attributes: TAttributes) => void;
  getSpanName?: (toolName: string) => string;
};

function defaultSpanName(toolName: string): string {
  return `tool.${toolName}`;
}

function getToolCallId(context: ToolExecutionContext | undefined): string | undefined {
  if (context === undefined || typeof context !== "object" || context === null) {
    return undefined;
  }
  const value = getOwnDataProperty(context, "toolCallId", "Tool trace execution context");
  return !isMissingOwnDataProperty(value) && typeof value === "string" ? value : undefined;
}

/** Wrap host tools with tracing metadata. */
export function traceHostTools<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  tools: HostToolSet,
  options: TraceHostToolsOptions<TAttributes>,
): HostToolSet {
  const traced: HostToolSet = {};
  const trace = options.trace;
  const buildAttributes = options.buildAttributes;
  const setAttributes = options.setAttributes;
  const getSpanName = options.getSpanName ?? defaultSpanName;
  if (
    typeof trace !== "function" ||
    (buildAttributes !== undefined && typeof buildAttributes !== "function") ||
    (setAttributes !== undefined && typeof setAttributes !== "function") ||
    typeof getSpanName !== "function"
  ) {
    throw new TypeError("Host tool trace callbacks must be functions");
  }

  for (
    const [toolName, definition] of getEnumerableOwnStringDataEntries(
      tools,
      "host tool set",
    )
  ) {
    if (typeof definition !== "object" || definition === null) continue;
    const definitionSnapshot = snapshotEnumerableOwnDataObject(
      definition,
      `host tool "${toolName}"`,
    ) as HostToolDefinition;
    const originalExecute = definitionSnapshot.execute;
    if (typeof originalExecute !== "function") {
      traced[toolName] = definition;
      continue;
    }

    traced[toolName] = {
      ...definitionSnapshot,
      execute: (input: unknown, context: ToolExecutionContext | undefined) =>
        trace(getSpanName(toolName), () => {
          const attributes = buildAttributes?.({
            toolName,
            toolCallId: getToolCallId(context),
            context,
          });
          if (attributes) {
            setAttributes?.(attributes);
          }
          return originalExecute(input, context);
        }),
    };
  }

  return traced;
}
