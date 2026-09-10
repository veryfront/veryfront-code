import type { ConversationRunEvent } from "#veryfront/agent/conversation/run-events.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { ProviderReplayCheckpoint } from "#veryfront/agent/runtime/provider-replay.ts";
import {
  copyExecutorReplayCheckpoints,
  createExecutorCheckpointStateOperations,
  type ExecutorInitialCheckpointState,
} from "./executor-checkpoint-state.ts";
import { parseProviderReplayCheckpoint } from "#veryfront/agent/runtime/provider-replay.ts";
import type { ToolExposureCheckpoint } from "#veryfront/agent/runtime/tool-exposure.ts";
import type { ExecutorBinding } from "../executor/protocol.ts";
import { getExecutorBindingSchema } from "../executor/protocol.ts";
import type {
  ExecutorChannel,
  ExecutorOperation,
  ExecutorOperationContext,
} from "../executor/channel.ts";
import type { ExecutorRuntimeFacades } from "./executor-runtime-prepare.ts";
import {
  type ExecutorPersistenceCapabilityIds,
  executorPersistenceJson,
  executorPersistenceOperations,
  getExecutorParentRunEventsRequestSchema,
  getExecutorPersistenceAckSchema,
  getExecutorPersistenceCapabilityIdsSchema,
  getExecutorProviderReplayCheckpointRequestSchema,
  getExecutorToolExposureCheckpointRequestSchema,
  getExecutorToolExposureCheckpointSchema,
  parseExecutorPersistenceData,
} from "./executor-persistence-schema.ts";
export type { ExecutorPersistenceCapabilityIds } from "./executor-persistence-schema.ts";

/**
 * Non-owning views over an authenticated channel. Each promise resolves only
 * after a broker acknowledgement. The session owner closes the shared channel
 * and retains `channel.settled`; these facades own no separate cleanup task.
 */
export type ExecutorPersistenceFacades = Pick<
  ExecutorRuntimeFacades,
  "publishParentRunEvents" | "toolExposureCheckpoint" | "providerReplayCheckpoint"
>;

type ExecutorPersistencePayload =
  | { events: ConversationRunEvent[] }
  | { checkpoint: ToolExposureCheckpoint | ProviderReplayCheckpoint };

function sameBinding(left: Readonly<ExecutorBinding>, right: Readonly<ExecutorBinding>): boolean {
  return left.allocationId === right.allocationId && left.generation === right.generation &&
    left.invocationId === right.invocationId;
}

function snapshotCapabilityIds(
  value: ExecutorPersistenceCapabilityIds,
): ExecutorPersistenceCapabilityIds {
  const result = parseExecutorPersistenceData(getExecutorPersistenceCapabilityIdsSchema(), value);
  return Object.freeze(result);
}

async function awaitPersistence(
  persistence: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const aborted = Promise.withResolvers<never>();
  const onAbort = () => aborted.reject(new TypeError("Managed persistence cancelled"));
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    await Promise.race([persistence, aborted.promise]);
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener("abort", onAbort);
    // Cancellation releases the caller independently. The handler retains the
    // original write so channel settlement still represents durable settlement.
    await persistence.catch(() => {});
  }
}

/**
 * Install trusted persistence handlers. Run identity and credentials remain in
 * the supplied closures and are absent from every strict channel DTO.
 */
export function createExecutorPersistenceBroker(
  options: ExecutorInitialCheckpointState & {
    expectedBinding: ExecutorBinding;
    capabilityIds: ExecutorPersistenceCapabilityIds;
    publishParentRunEvents?: NonNullable<ExecutorPersistenceFacades["publishParentRunEvents"]>;
    persistToolExposureCheckpoint?: NonNullable<
      NonNullable<ExecutorPersistenceFacades["toolExposureCheckpoint"]>["persist"]
    >;
    persistProviderReplayCheckpoint?: NonNullable<
      NonNullable<ExecutorPersistenceFacades["providerReplayCheckpoint"]>["persist"]
    >;
  },
): ReadonlyMap<string, ExecutorOperation> {
  const expectedBinding = Object.freeze(getExecutorBindingSchema().parse(options.expectedBinding));
  const capabilityIds = snapshotCapabilityIds(options.capabilityIds);
  const definitions = [
    ["publishParentRunEvents", options.publishParentRunEvents],
    ["toolExposureCheckpoint", options.persistToolExposureCheckpoint],
    ["providerReplayCheckpoint", options.persistProviderReplayCheckpoint],
  ] as const;
  for (const [name, callback] of definitions) {
    if ((capabilityIds[name] === undefined) !== (callback === undefined)) {
      throw new TypeError("Managed persistence capability configuration is incomplete");
    }
  }

  let lastAcceptedSequence = 0;
  let persistenceTail = Promise.resolve();
  const authorize = (
    capabilityId: string,
    sequence: number,
    expectedCapabilityId: string,
    context: ExecutorOperationContext,
  ) => {
    if (
      !sameBinding(expectedBinding, context.binding) || capabilityId !== expectedCapabilityId ||
      sequence <= lastAcceptedSequence
    ) throw new TypeError("Managed persistence operation is not authorized");
    // Unsent calls can consume a client sequence before channel admission.
    // Gaps are safe; replays and out-of-order accepted writes are forbidden.
    lastAcceptedSequence = sequence;
  };
  const persist = async (
    sequence: number,
    context: ExecutorOperationContext,
    write: () => void | Promise<void>,
  ) => {
    const persistence = persistenceTail.then(write);
    persistenceTail = persistence.catch(() => {});
    await awaitPersistence(persistence, context.signal);
    return executorPersistenceJson({ acknowledged: true, sequence });
  };
  const operations = new Map<string, ExecutorOperation>(
    createExecutorCheckpointStateOperations({ ...options, expectedBinding, capabilityIds }),
  );
  if (capabilityIds.publishParentRunEvents && options.publishParentRunEvents) {
    const capabilityId = capabilityIds.publishParentRunEvents;
    const publish = options.publishParentRunEvents;
    operations.set(executorPersistenceOperations.publishParentRunEvents, {
      mode: "unary",
      async handle(value, context) {
        const request = parseExecutorPersistenceData(
          getExecutorParentRunEventsRequestSchema(),
          value,
        );
        authorize(request.capabilityId, request.sequence, capabilityId, context);
        return await persist(request.sequence, context, () => publish(request.events));
      },
    });
  }
  if (capabilityIds.toolExposureCheckpoint && options.persistToolExposureCheckpoint) {
    const capabilityId = capabilityIds.toolExposureCheckpoint;
    const persistCheckpoint = options.persistToolExposureCheckpoint;
    operations.set(executorPersistenceOperations.persistToolExposureCheckpoint, {
      mode: "unary",
      async handle(value, context) {
        const request = parseExecutorPersistenceData(
          getExecutorToolExposureCheckpointRequestSchema(),
          value,
        );
        authorize(request.capabilityId, request.sequence, capabilityId, context);
        return await persist(
          request.sequence,
          context,
          () => persistCheckpoint(request.checkpoint),
        );
      },
    });
  }
  if (capabilityIds.providerReplayCheckpoint && options.persistProviderReplayCheckpoint) {
    const capabilityId = capabilityIds.providerReplayCheckpoint;
    const persistCheckpoint = options.persistProviderReplayCheckpoint;
    operations.set(executorPersistenceOperations.persistProviderReplayCheckpoint, {
      mode: "unary",
      async handle(value, context) {
        const request = parseExecutorPersistenceData(
          getExecutorProviderReplayCheckpointRequestSchema(),
          value,
        );
        const checkpoint = parseProviderReplayCheckpoint(request.checkpoint);
        authorize(request.capabilityId, request.sequence, capabilityId, context);
        return await persist(request.sequence, context, () => persistCheckpoint(checkpoint));
      },
    });
  }
  return operations;
}

/** Create executor-local facades over one authenticated invocation channel. */
export function createExecutorPersistenceFacades(options: {
  channel: ExecutorChannel;
  capabilityIds: ExecutorPersistenceCapabilityIds;
  /** Optional view lifetime; does not transfer ownership of the shared channel. */
  signal?: AbortSignal;
  initialToolExposureCheckpoint?: ToolExposureCheckpoint;
  initialProviderReplayCheckpoints?: readonly ProviderReplayCheckpoint[];
}): ExecutorPersistenceFacades {
  const capabilityIds = snapshotCapabilityIds(options.capabilityIds);
  if (options.initialToolExposureCheckpoint && !capabilityIds.toolExposureCheckpoint) {
    throw new TypeError("Managed tool checkpoint capability is required");
  }
  if (options.initialProviderReplayCheckpoints && !capabilityIds.providerReplayCheckpoint) {
    throw new TypeError("Managed provider checkpoint capability is required");
  }
  const initialToolExposureCheckpoint = options.initialToolExposureCheckpoint === undefined
    ? undefined
    : parseExecutorPersistenceData(
      getExecutorToolExposureCheckpointSchema(),
      executorPersistenceJson(options.initialToolExposureCheckpoint),
    );
  const initialProviderReplayCheckpoints = options.initialProviderReplayCheckpoints === undefined
    ? undefined
    : copyExecutorReplayCheckpoints(options.initialProviderReplayCheckpoints);
  let sequence = 0;
  const request = async (
    operation: string,
    capabilityId: string,
    payload: ExecutorPersistencePayload,
    schema: Schema<unknown>,
  ) => {
    options.signal?.throwIfAborted();
    if (sequence === Number.MAX_SAFE_INTEGER) {
      throw new TypeError("Managed persistence call limit exceeded");
    }
    const callSequence = sequence + 1;
    const input = executorPersistenceJson({ capabilityId, sequence: callSequence, ...payload });
    parseExecutorPersistenceData(schema, input);
    sequence = callSequence;
    const result = await options.channel.request(
      operation,
      input,
      { signal: options.signal },
    );
    const ack = parseExecutorPersistenceData(getExecutorPersistenceAckSchema(), result);
    if (ack.sequence !== callSequence) {
      throw new TypeError("Invalid managed persistence acknowledgement");
    }
  };
  return {
    ...(capabilityIds.publishParentRunEvents
      ? {
        publishParentRunEvents: (events: ConversationRunEvent[]) =>
          request(
            executorPersistenceOperations.publishParentRunEvents,
            capabilityIds.publishParentRunEvents!,
            { events },
            getExecutorParentRunEventsRequestSchema(),
          ),
      }
      : {}),
    ...(capabilityIds.toolExposureCheckpoint
      ? {
        toolExposureCheckpoint: {
          initial: initialToolExposureCheckpoint,
          persist: (checkpoint: ToolExposureCheckpoint) =>
            request(
              executorPersistenceOperations.persistToolExposureCheckpoint,
              capabilityIds.toolExposureCheckpoint!,
              { checkpoint },
              getExecutorToolExposureCheckpointRequestSchema(),
            ),
        },
      }
      : {}),
    ...(capabilityIds.providerReplayCheckpoint
      ? {
        providerReplayCheckpoint: {
          initial: initialProviderReplayCheckpoints,
          persist: (checkpoint: ProviderReplayCheckpoint) => {
            const parsed = parseProviderReplayCheckpoint(
              executorPersistenceJson(checkpoint),
            );
            return request(
              executorPersistenceOperations.persistProviderReplayCheckpoint,
              capabilityIds.providerReplayCheckpoint!,
              { checkpoint: parsed },
              getExecutorProviderReplayCheckpointRequestSchema(),
            );
          },
        },
      }
      : {}),
  };
}
