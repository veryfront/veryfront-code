import type { HostToolSet } from "./host-tools.ts";
import type { ToolExecutionContext } from "./types.ts";
import { inheritFrameworkSkillLoader } from "#veryfront/skill/loader-provenance.ts";
import {
  hasTrustedHostToolProvenance,
  inheritTrustedHostToolProvenance,
} from "./host-tool-provenance.ts";
import { copyTrustedHostToolDefinition } from "./host-tool-definition-copy.ts";

const apply = Reflect.apply;
const objectDefineProperty = Object.defineProperty;

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
      traced[toolName] = definition;
      continue;
    }

    const originalExecute = definition.execute;
    // A trusted definition keeps its getters live (load_skill's advertised schema
    // refreshes authorization on each read); spreading would evaluate them once.
    const wrapper: HostToolSet[string] = hasTrustedHostToolProvenance(definition)
      ? copyTrustedHostToolDefinition({}, definition)
      : { ...definition };
    objectDefineProperty(wrapper, "execute", {
      configurable: true,
      enumerable: true,
      writable: true,
      // A method, so the receiver a host binds (a gated tool reads its exposed name from
      // `this.id`) reaches the original execute.
      value: function execute(
        this: unknown,
        input: unknown,
        context: ToolExecutionContext | undefined,
      ) {
        return options.trace(getSpanName(toolName), () => {
          const attributes = options.buildAttributes?.({
            toolName,
            toolCallId: getToolCallId(context),
            context,
          });
          if (attributes) {
            options.setAttributes?.(attributes);
          }
          return apply(originalExecute, this, [input, context]);
        });
      },
    });
    traced[toolName] = inheritTrustedHostToolProvenance(
      definition,
      inheritFrameworkSkillLoader(definition, wrapper),
    );
  }

  return traced;
}
