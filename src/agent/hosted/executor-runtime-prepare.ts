import type { ExecutorBinding } from "#veryfront/agent/executor/protocol.ts";
import type { ExecutorDiscovery } from "#veryfront/agent/hosted/executor-discovery.ts";
import type { ExecutorDiscoverySource } from "#veryfront/agent/hosted/executor-discovery-schema.ts";
import { ExecutorRuntimePreparationError } from "#veryfront/agent/hosted/executor-runtime-prepare-schema.ts";
import { createPreparedHostedRuntimeAgent } from "#veryfront/agent/hosted/default-chat-runtime.ts";
import {
  getProjectAgentRuntimeInlineTools,
  type ProjectAgentRuntimeDiscovery,
  runWithProjectAgentRuntime,
} from "#veryfront/agent/project/agent-runtime.ts";
import { isToolVisibleTo } from "#veryfront/tool/executor.ts";
import { isSkillInfrastructureToolId } from "#veryfront/skill/types.ts";
import { filterPrivateArray } from "#veryfront/security/private-array.ts";
import { chainPrivatePromise, resolvePrivatePromise } from "#veryfront/security/private-promise.ts";
import {
  createRuntimePreparationCore,
  type ExecutorRuntimeFacades,
  type ExecutorRuntimePreparationGrant,
} from "#veryfront/agent/hosted/runtime-preparation-core.ts";

export type {
  ExecutorRuntimeFacades,
  ExecutorRuntimePreparationGrant,
} from "#veryfront/agent/hosted/runtime-preparation-core.ts";

const mapGet = Map.prototype.get;
const apply = Reflect.apply;

interface Options {
  binding: ExecutorBinding;
  source: ExecutorDiscoverySource;
  discovery: ExecutorDiscovery;
  grant?: ExecutorRuntimePreparationGrant;
  facades: ExecutorRuntimeFacades;
}

/** Preserve executor-local discovery and preparation without duplicating runtime policy. */
export function createExecutorRuntimePreparation(input: Options) {
  const discovery = input.discovery;
  let runtime: ProjectAgentRuntimeDiscovery | undefined;
  const owner = createRuntimePreparationCore({
    binding: input.binding,
    source: input.source,
    grant: input.grant,
    facades: input.facades,
    project: {
      signal: discovery.signal,
      async prepare(agentId, context) {
        const operation = apply(mapGet, discovery.operations, ["agent.describe"]);
        if (operation?.mode !== "unary") {
          throw new ExecutorRuntimePreparationError("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
        }
        const description = await chainPrivatePromise(
          resolvePrivatePromise(),
          () => operation.handle({ agentId }, context),
        );
        runtime = discovery.getRuntime();
        const localTools = new Map(runtime.tools);
        for (const [name, tool] of getProjectAgentRuntimeInlineTools(runtime, agentId)) {
          localTools.set(name, tool);
        }
        return {
          __proto__: null,
          description,
          localTools: Object.fromEntries(filterPrivateArray(
            [...localTools],
            ([id, value]) =>
              !isSkillInfrastructureToolId(id) && isToolVisibleTo(value, { agentId }),
          )),
          sourceIntegrationPolicy: runtime.sourceIntegrationPolicy,
        };
      },
      instantiate: (options, runtimeOptions) => {
        if (!runtime) throw new ExecutorRuntimePreparationError("EXECUTOR_RUNTIME_NOT_PREPARED");
        return runWithProjectAgentRuntime(
          runtime,
          () => createPreparedHostedRuntimeAgent(options, runtimeOptions),
        );
      },
      retainTask: (task) => discovery.retainRuntimeTask(task),
      close: () => discovery.close(),
    },
  });
  return { ...owner, operations: new Map([...discovery.operations, ...owner.operations]) };
}
