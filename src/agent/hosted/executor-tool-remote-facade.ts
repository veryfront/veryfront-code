import type { JsonValue } from "#veryfront/schemas/index.ts";
import type {
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool/types.ts";
import type { ExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import { copyPrivateSet, createPrivateSet } from "#veryfront/security/private-set.ts";
import { captureExecutorProjectCallContext } from "#veryfront/agent/hosted/executor-project-context.ts";
import { ExecutorAgentError } from "#veryfront/agent/hosted/executor-agent-schema.ts";
import {
  executorToolBytes,
  executorToolDefinition,
  executorToolFailure,
  type ExecutorToolFrame,
  executorToolJson,
  type ExecutorToolLimits,
  executorToolLimits,
  executorToolProgress,
  getExecutorToolCallSchema,
  getExecutorToolFrameSchema,
  getExecutorToolListSchema,
  isExecutorToolSettledFailure,
  parseExecutorToolData,
  throwExecutorToolFailure,
} from "#veryfront/agent/hosted/executor-tool-schema.ts";

function callerCorrelation(context?: ToolExecutionContext) {
  return {
    ...(context?.toolCallId === undefined ? {} : { toolCallId: context.toolCallId }),
    ...(context?.progressToken === undefined ? {} : { progressToken: context.progressToken }),
  };
}

/**
 * Executor-local RemoteToolSource facades. Discover bounded source IDs from the
 * bound channel; all authority stays with broker construction. No retry or replay.
 * Caller context supplies only local cancellation/publication and correlation.
 */
export async function createExecutorRemoteToolSources(options: {
  channel: ExecutorChannel;
  signal?: AbortSignal;
  limits?: Partial<ExecutorToolLimits>;
  /** Only these trusted source slots may receive dynamic project skill context. */
  projectContextSources?: ReadonlySet<string>;
}): Promise<RemoteToolSource[]> {
  const channel = options.channel;
  const lifetime = options.signal ?? channel.signal;
  const limits = executorToolLimits(options.limits);
  const projectContextSources = options.projectContextSources
    ? copyPrivateSet(options.projectContextSources, limits.maxSources)
    : createPrivateSet<string>();
  let metadataBytes = 0;
  let metadataTools = 0;
  const accountMetadata = (frame: JsonValue) => {
    metadataBytes += executorToolBytes(frame);
    if (metadataBytes > limits.maxMetadataBytes) {
      throw new TypeError("Executor tool metadata limit exceeded");
    }
  };

  async function consume(
    operation: string,
    input: JsonValue,
    onFrame: (frame: ExecutorToolFrame) => void,
    context?: ToolExecutionContext,
  ): Promise<JsonValue | undefined> {
    let iterator: AsyncIterableIterator<JsonValue> | undefined;
    let complete = false;
    try {
      const signal = AbortSignal.any([
        lifetime,
        channel.signal,
        ...(context?.abortSignal ? [context.abortSignal] : []),
      ]);
      signal.throwIfAborted();
      iterator = channel.stream(operation, input, { signal });
      let terminal = false;
      let failure: ExecutorToolFrame | undefined;
      let result: JsonValue | undefined;
      let progressCount = 0;
      let progressBytes = 0;
      while (true) {
        const next = await iterator.next();
        signal.throwIfAborted();
        if (next.done) {
          if (!terminal) throw new TypeError("Executor tool completion is missing");
          complete = true;
          if (failure) throwExecutorToolFailure(failure, true);
          return result;
        }
        if (terminal) throw new TypeError("Executor tool has multiple terminal frames");
        const frame = parseExecutorToolData(getExecutorToolFrameSchema(), next.value);
        if (frame.type === "failure") {
          failure = frame;
          terminal = true;
        } else if (frame.type === "progress" && operation !== "tool.sources") {
          const event = executorToolProgress(frame.event, limits);
          if (
            ++progressCount > limits.maxProgressEvents ||
            (progressBytes += executorToolBytes(next.value)) > limits.maxProgressBytes
          ) {
            throw new TypeError("Executor tool progress limit exceeded");
          }
          // Joining the local publisher also keeps channel consumption bounded.
          try {
            await context?.publishDataEvent?.(event);
          } catch (error) {
            // Only this local callback can classify its failure. Reconstruct
            // fixed diagnostics before the outer transport catch sees it.
            throwExecutorToolFailure(executorToolFailure(error));
          }
        } else if (operation === "tool.execute" && frame.type === "result") {
          result = executorToolJson(frame.result, limits.maxResultBytes);
          terminal = true;
        } else if (operation !== "tool.execute" && frame.type === "complete") {
          terminal = true;
        } else onFrame(frame);
      }
    } catch (error) {
      // Never expose peer/transport diagnostics or classify an unknown failure.
      throw isExecutorToolSettledFailure(error) || error instanceof ExecutorAgentError
        ? error
        : new TypeError("Executor tool operation failed");
    } finally {
      if (!complete) await iterator?.return?.().catch(() => {});
    }
  }

  const ids = createPrivateSet<string>();
  await consume("tool.sources", {}, (frame) => {
    if (frame.type !== "source" || ids.has(frame.sourceId) || ids.size >= limits.maxSources) {
      throw new TypeError("Invalid executor tool sources");
    }
    accountMetadata(frame);
    ids.add(frame.sourceId);
  });
  for (const sourceId of projectContextSources) {
    if (!ids.has(sourceId)) throw new TypeError("Project context source is unavailable");
  }
  return [...ids].map((sourceId): RemoteToolSource =>
    Object.freeze({
      id: sourceId,
      async listTools(context?: ToolExecutionContext) {
        const definitions: ToolDefinition[] = [];
        const names = createPrivateSet<string>();
        const request = parseExecutorToolData(getExecutorToolListSchema(), {
          sourceId,
          ...callerCorrelation(context),
        });
        await consume("tool.list", request, (frame) => {
          if (
            frame.type !== "tool" || definitions.length >= limits.maxToolsPerSource ||
            ++metadataTools > limits.maxTotalTools
          ) {
            throw new TypeError("Invalid executor tool metadata");
          }
          const definition = executorToolDefinition(frame.definition, limits);
          if (names.has(definition.name)) throw new TypeError("Duplicate executor tool definition");
          accountMetadata(executorToolJson(frame));
          names.add(definition.name);
          definitions.push(definition);
        }, context);
        return definitions;
      },
      async executeTool(
        toolName: string,
        args: Record<string, unknown>,
        context?: ToolExecutionContext,
      ) {
        const projectContext = projectContextSources.has(sourceId)
          ? captureExecutorProjectCallContext(context)
          : undefined;
        const request = parseExecutorToolData(getExecutorToolCallSchema(), {
          sourceId,
          toolName,
          args: executorToolJson(args, limits.maxArgumentBytes),
          ...callerCorrelation(context),
          ...(projectContext === undefined ? {} : { projectContext }),
        });
        return await consume("tool.execute", request, () => {
          throw new TypeError("Invalid executor tool execution frame");
        }, context);
      },
    })
  );
}
