import type { AgentSystem } from "#veryfront/agent/types.ts";
import type { RuntimeAgentMarkdownDefinition } from "#veryfront/agent/runtime/agent-definition.ts";
import type { HostedChatRuntimeProjectSteering } from "./chat-runtime-contract.ts";
import type { ExecutorBinding } from "../executor/protocol.ts";
import { getExecutorBindingSchema } from "../executor/protocol.ts";
import type {
  ExecutorChannel,
  ExecutorOperation,
  ExecutorOperationContext,
} from "../executor/channel.ts";
import {
  type ExecutorStateCapabilityIds,
  executorStateJson,
  executorStateOperations,
  getExecutorAgentSystemSchema,
  getExecutorConversationUserTextResultSchema,
  getExecutorProjectSteeringPrepareRequestSchema,
  getExecutorProjectSteeringResultSchema,
  getExecutorStateCapabilityIdsSchema,
  getExecutorStateReadRequestSchema,
  parseExecutorStateData,
} from "./executor-state-schema.ts";
import { getExecutorDiscoveryIdSchema } from "./executor-discovery-schema.ts";

export type { ExecutorStateCapabilityIds } from "./executor-state-schema.ts";

type Scope = { agentId: string; projectId: string | null; branchId?: string | null };
type ProjectSteeringPrepareInput = {
  definition: RuntimeAgentMarkdownDefinition;
  projectId: string | null;
  branchId?: string | null;
  signal: AbortSignal;
};
export interface ExecutorStateFacades {
  projectSteering?: {
    prepare(input: ProjectSteeringPrepareInput): Promise<
      HostedChatRuntimeProjectSteering<RuntimeAgentMarkdownDefinition>
    >;
    refresh(signal: AbortSignal): Promise<AgentSystem>;
  };
  latestConversationUserText?: (signal: AbortSignal) => Promise<string | null>;
}

function sameBinding(left: Readonly<ExecutorBinding>, right: Readonly<ExecutorBinding>) {
  return left.allocationId === right.allocationId && left.generation === right.generation &&
    left.invocationId === right.invocationId;
}
function parseScope(value: Scope): Scope {
  return Object.freeze({
    agentId: parseExecutorStateData(getExecutorDiscoveryIdSchema(), value.agentId),
    projectId: value.projectId === null
      ? null
      : parseExecutorStateData(getExecutorDiscoveryIdSchema(), value.projectId),
    ...(value.branchId === undefined ? {} : {
      branchId: value.branchId === null
        ? null
        : parseExecutorStateData(getExecutorDiscoveryIdSchema(), value.branchId),
    }),
  });
}
function authorize(
  context: ExecutorOperationContext,
  expectedBinding: ExecutorBinding,
  actual: string,
  expected: string,
) {
  if (!sameBinding(context.binding, expectedBinding) || actual !== expected) {
    throw new TypeError("Managed state operation is not authorized");
  }
}

export function createExecutorStateBroker(
  options: Scope & {
    expectedBinding: ExecutorBinding;
    capabilityIds: ExecutorStateCapabilityIds;
    prepareProjectSteering?: (
      input: ProjectSteeringPrepareInput,
    ) => Promise<HostedChatRuntimeProjectSteering<RuntimeAgentMarkdownDefinition>>;
    refreshProjectSteering?: (signal: AbortSignal) => Promise<AgentSystem> | AgentSystem;
    latestConversationUserText?: NonNullable<ExecutorStateFacades["latestConversationUserText"]>;
  },
): ReadonlyMap<string, ExecutorOperation> {
  const expectedBinding = Object.freeze(getExecutorBindingSchema().parse(options.expectedBinding));
  const scope = parseScope(options);
  const capabilityIds = Object.freeze(
    parseExecutorStateData(getExecutorStateCapabilityIdsSchema(), options.capabilityIds),
  );
  const hasSteering = options.prepareProjectSteering !== undefined &&
    options.refreshProjectSteering !== undefined;
  if (
    (capabilityIds.projectSteering !== undefined) !== hasSteering ||
    (!!options.prepareProjectSteering !== !!options.refreshProjectSteering)
  ) throw new TypeError("Managed state capability configuration is incomplete");
  if (
    (capabilityIds.conversationUserText === undefined) !==
      (options.latestConversationUserText === undefined)
  ) throw new TypeError("Managed state capability configuration is incomplete");
  const operations = new Map<string, ExecutorOperation>();
  let steeringTail = Promise.resolve<unknown>(undefined);
  const scheduleSteering = <T>(
    context: ExecutorOperationContext,
    work: () => Promise<T> | T,
  ): Promise<T> => {
    const current = steeringTail.then(() => {
      context.signal.throwIfAborted();
      return work();
    });
    steeringTail = current.catch(() => {});
    return current;
  };
  if (
    capabilityIds.projectSteering && options.prepareProjectSteering &&
    options.refreshProjectSteering
  ) {
    const capabilityId = capabilityIds.projectSteering;
    const prepare = options.prepareProjectSteering;
    const refresh = options.refreshProjectSteering;
    operations.set(executorStateOperations.prepareProjectSteering, {
      mode: "unary",
      async handle(value, context) {
        const request = parseExecutorStateData(
          getExecutorProjectSteeringPrepareRequestSchema(),
          value,
        );
        authorize(context, expectedBinding, request.capabilityId, capabilityId);
        if (request.definition.id !== scope.agentId) {
          throw new TypeError("Managed state agent is not authorized");
        }
        const result = await scheduleSteering(
          context,
          () => prepare({ ...scope, definition: request.definition, signal: context.signal }),
        );
        const parsed = parseExecutorStateData(
          getExecutorProjectSteeringResultSchema(),
          executorStateJson(result),
        );
        if (parsed.agent.id !== scope.agentId) {
          throw new TypeError("Managed state result is not authorized");
        }
        return executorStateJson(parsed);
      },
    });
    operations.set(executorStateOperations.refreshProjectSteering, {
      mode: "unary",
      async handle(value, context) {
        const request = parseExecutorStateData(getExecutorStateReadRequestSchema(), value);
        authorize(context, expectedBinding, request.capabilityId, capabilityId);
        const result = await scheduleSteering(context, () => refresh(context.signal));
        return executorStateJson(
          parseExecutorStateData(getExecutorAgentSystemSchema(), executorStateJson(result)),
        );
      },
    });
  }
  if (capabilityIds.conversationUserText && options.latestConversationUserText) {
    const capabilityId = capabilityIds.conversationUserText;
    const read = options.latestConversationUserText;
    operations.set(executorStateOperations.latestConversationUserText, {
      mode: "unary",
      async handle(value, context) {
        const request = parseExecutorStateData(getExecutorStateReadRequestSchema(), value);
        authorize(context, expectedBinding, request.capabilityId, capabilityId);
        const text = await read(context.signal);
        return executorStateJson(
          parseExecutorStateData(getExecutorConversationUserTextResultSchema(), { text }),
        );
      },
    });
  }
  return operations;
}

export function createExecutorStateFacades(
  options: Scope & {
    channel: ExecutorChannel;
    capabilityIds: ExecutorStateCapabilityIds;
    signal?: AbortSignal;
  },
): ExecutorStateFacades {
  const scope = parseScope(options);
  const capabilityIds = Object.freeze(
    parseExecutorStateData(getExecutorStateCapabilityIdsSchema(), options.capabilityIds),
  );
  return {
    ...(capabilityIds.projectSteering
      ? {
        projectSteering: {
          async prepare(input: ProjectSteeringPrepareInput) {
            if (
              scope.projectId !== input.projectId || scope.branchId !== input.branchId ||
              input.definition.id !== scope.agentId
            ) {
              throw new TypeError("Managed state scope cannot change");
            }
            const request = executorStateJson({
              capabilityId: capabilityIds.projectSteering,
              definition: input.definition,
            });
            parseExecutorStateData(getExecutorProjectSteeringPrepareRequestSchema(), request);
            const signal = options.signal
              ? AbortSignal.any([options.signal, input.signal])
              : input.signal;
            const result = await options.channel.request(
              executorStateOperations.prepareProjectSteering,
              request,
              { signal },
            );
            const parsed = parseExecutorStateData(getExecutorProjectSteeringResultSchema(), result);
            if (parsed.agent.id !== scope.agentId) {
              throw new TypeError(
                "Managed state result is not authorized",
              );
            }
            return parsed;
          },
          async refresh(signal: AbortSignal) {
            const combined = options.signal ? AbortSignal.any([options.signal, signal]) : signal;
            const result = await options.channel.request(
              executorStateOperations.refreshProjectSteering,
              { capabilityId: capabilityIds.projectSteering! },
              { signal: combined },
            );
            return parseExecutorStateData(getExecutorAgentSystemSchema(), result);
          },
        },
      }
      : {}),
    ...(capabilityIds.conversationUserText
      ? {
        latestConversationUserText: async (signal: AbortSignal) => {
          const combined = options.signal ? AbortSignal.any([options.signal, signal]) : signal;
          const result = await options.channel.request(
            executorStateOperations.latestConversationUserText,
            { capabilityId: capabilityIds.conversationUserText! },
            { signal: combined },
          );
          return parseExecutorStateData(getExecutorConversationUserTextResultSchema(), result).text;
        },
      }
      : {}),
  };
}
