import type { ExecutorChannel, ExecutorOperation } from "../executor/channel.ts";
import { type ExecutorBinding, getExecutorBindingSchema } from "../executor/protocol.ts";
import { defineSchema, type JsonValue } from "#veryfront/schemas/index.ts";
import type { ToolExposureCheckpoint } from "../runtime/tool-exposure.ts";
import {
  parseServerResolvedProviderReplayCheckpoints,
  type ProviderReplayCheckpoint,
} from "../runtime/provider-replay.ts";
import {
  type ExecutorPersistenceCapabilityIds,
  executorPersistenceJson,
  getExecutorPersistenceCapabilityIdsSchema,
  getExecutorProviderReplayCheckpointSchema,
  getExecutorToolExposureCheckpointSchema,
  parseExecutorPersistenceData,
} from "./executor-persistence-schema.ts";

export const executorInitialCheckpointsOperation = "persistence.initial-checkpoints";
const MAX_CHECKPOINTS = 100;
const getRequestSchema = defineSchema((v) =>
  v.object({
    capabilityId: v.string().min(1).max(128),
    kind: v.enum(["tool-exposure", "provider-replay"] as const),
  }).strict()
);
const getFrameSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({
      type: v.literal("tool-exposure"),
      checkpoint: getExecutorToolExposureCheckpointSchema(),
    }).strict(),
    v.object({
      type: v.literal("provider-replay"),
      checkpoint: getExecutorProviderReplayCheckpointSchema(),
    }).strict(),
    v.object({ type: v.literal("complete") }).strict(),
  ])
);

export interface ExecutorInitialCheckpointState {
  initialToolExposureCheckpoint?: ToolExposureCheckpoint;
  initialProviderReplayCheckpoints?: readonly ProviderReplayCheckpoint[];
}

/** Bound each checkpoint independently, matching the write path and canonical delivery count. */
export function copyExecutorReplayCheckpoints(
  value: readonly ProviderReplayCheckpoint[],
): ProviderReplayCheckpoint[] {
  if (!Array.isArray(value) || value.length > MAX_CHECKPOINTS) {
    throw new TypeError("Invalid executor checkpoint state");
  }
  return parseServerResolvedProviderReplayCheckpoints(
    value.map((checkpoint) =>
      parseExecutorPersistenceData(
        getExecutorProviderReplayCheckpointSchema(),
        executorPersistenceJson(checkpoint),
      )
    ),
  );
}

/** Each granted snapshot can be read once. State is never placed in runtime.install. */
export function createExecutorCheckpointStateOperations(
  options: ExecutorInitialCheckpointState & {
    expectedBinding: ExecutorBinding;
    capabilityIds: ExecutorPersistenceCapabilityIds;
  },
): ReadonlyMap<string, ExecutorOperation> {
  const ids = getExecutorPersistenceCapabilityIdsSchema().parse(options.capabilityIds);
  const binding = Object.freeze(getExecutorBindingSchema().parse(options.expectedBinding));
  if (
    options.initialToolExposureCheckpoint && !ids.toolExposureCheckpoint ||
    (options.initialProviderReplayCheckpoints?.length ?? 0) > 0 && !ids.providerReplayCheckpoint
  ) throw new TypeError("Executor checkpoint state is not granted");
  const tool = options.initialToolExposureCheckpoint === undefined
    ? undefined
    : parseExecutorPersistenceData(
      getExecutorToolExposureCheckpointSchema(),
      executorPersistenceJson(options.initialToolExposureCheckpoint),
    );
  const provider = copyExecutorReplayCheckpoints(options.initialProviderReplayCheckpoints ?? []);
  const read = new Set<string>();
  if (!ids.toolExposureCheckpoint && !ids.providerReplayCheckpoint) return new Map();
  return new Map([[executorInitialCheckpointsOperation, {
    mode: "stream",
    async *handle(value, context): AsyncGenerator<JsonValue> {
      const request = parseExecutorPersistenceData(getRequestSchema(), value);
      context.signal.throwIfAborted();
      const expected = request.kind === "tool-exposure"
        ? ids.toolExposureCheckpoint
        : ids.providerReplayCheckpoint;
      if (
        !expected || request.capabilityId !== expected || read.has(request.kind) ||
        context.binding.allocationId !== binding.allocationId ||
        context.binding.generation !== binding.generation ||
        context.binding.invocationId !== binding.invocationId || context.deadline <= Date.now()
      ) throw new TypeError("Executor checkpoint state is not authorized");
      read.add(request.kind);
      if (request.kind === "tool-exposure" && tool) {
        yield executorPersistenceJson({ type: "tool-exposure", checkpoint: tool });
      }
      if (request.kind === "provider-replay") {
        for (const checkpoint of provider) {
          context.signal.throwIfAborted();
          if (context.deadline <= Date.now()) {
            throw new TypeError("Executor checkpoint state expired");
          }
          yield executorPersistenceJson({ type: "provider-replay", checkpoint });
        }
      }
      context.signal.throwIfAborted();
      yield { type: "complete" };
    },
  }]]);
}

export async function readExecutorInitialCheckpoints(options: {
  channel: ExecutorChannel;
  capabilityIds: ExecutorPersistenceCapabilityIds;
  signal?: AbortSignal;
}): Promise<ExecutorInitialCheckpointState> {
  const state: ExecutorInitialCheckpointState = {};
  for (
    const [kind, capabilityId] of [
      ["tool-exposure", options.capabilityIds.toolExposureCheckpoint],
      ["provider-replay", options.capabilityIds.providerReplayCheckpoint],
    ] as const
  ) {
    if (!capabilityId) continue;
    let complete = false;
    let count = 0;
    const provider: ProviderReplayCheckpoint[] = [];
    const frames = options.channel.stream(executorInitialCheckpointsOperation, {
      capabilityId,
      kind,
    }, { signal: options.signal });
    for await (const value of frames) {
      const frame = parseExecutorPersistenceData(getFrameSchema(), value);
      if (complete) throw new TypeError("Invalid executor checkpoint completion");
      if (frame.type === "complete") {
        complete = true;
        continue;
      }
      if (frame.type !== kind || ++count > (kind === "tool-exposure" ? 1 : MAX_CHECKPOINTS)) {
        throw new TypeError("Invalid executor checkpoint state");
      }
      if (frame.type === "tool-exposure") state.initialToolExposureCheckpoint = frame.checkpoint;
      else provider.push(frame.checkpoint);
    }
    if (!complete) throw new TypeError("Missing executor checkpoint completion");
    if (kind === "provider-replay") {
      state.initialProviderReplayCheckpoints = copyExecutorReplayCheckpoints(provider);
    }
  }
  return state;
}
