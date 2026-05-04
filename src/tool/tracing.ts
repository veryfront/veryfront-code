import type { HostToolSet } from "./host-tools.ts";
import type { ToolExecutionContext } from "./types.ts";

export type HostToolTraceRunner = <TResult>(
  spanName: string,
  operation: () => TResult,
) => TResult;

export type HostToolTraceAttributes = Record<string, unknown>;

export type HostToolTraceAttributeInput = {
  toolName: string;
  toolCallId: string | undefined;
  context: ToolExecutionContext | undefined;
};

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
  return typeof context?.toolCallId === "string" ? context.toolCallId : undefined;
}

export function traceHostTools<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  tools: HostToolSet,
  options: TraceHostToolsOptions<TAttributes>,
): HostToolSet {
  const traced: HostToolSet = {};
  const getSpanName = options.getSpanName ?? defaultSpanName;

  for (const [toolName, definition] of Object.entries(tools)) {
    if (!definition.execute) {
      traced[toolName] = definition;
      continue;
    }

    const originalExecute = definition.execute;
    traced[toolName] = {
      ...definition,
      execute: (input: unknown, context: ToolExecutionContext | undefined) =>
        options.trace(getSpanName(toolName), () => {
          const attributes = options.buildAttributes?.({
            toolName,
            toolCallId: getToolCallId(context),
            context,
          });
          if (attributes) {
            options.setAttributes?.(attributes);
          }
          return originalExecute(input, context);
        }),
    };
  }

  return traced;
}
