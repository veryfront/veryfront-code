import type { HostToolSet } from "./host-tools.ts";
import type { ToolExecutionContext } from "./types.ts";

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
  return typeof context?.toolCallId === "string" ? context.toolCallId : undefined;
}

function defineTracedTool(
  tools: HostToolSet,
  toolName: string,
  definition: HostToolSet[string],
): void {
  Object.defineProperty(tools, toolName, {
    value: definition,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/** Wrap host tools with tracing metadata. */
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
      defineTracedTool(traced, toolName, definition);
      continue;
    }

    const originalExecute = definition.execute;
    const tracedDefinition = {
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
    defineTracedTool(traced, toolName, tracedDefinition);
  }

  return traced;
}
