import type { ExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import type { ExecutorBinding } from "#veryfront/agent/executor/protocol.ts";
import type { ExecutorDiscoverySource } from "#veryfront/agent/hosted/executor-discovery-schema.ts";
import {
  createPreparedHostedRuntimeAgent,
  type PreparedHostedRuntimeAgentOptions,
} from "#veryfront/agent/hosted/default-chat-runtime.ts";
import { parseSourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import { snapshotOwnDataRecords } from "#veryfront/security/own-data-record.ts";
import type { ExecutorProjectToolSource } from "#veryfront/agent/hosted/executor-project-tools.ts";
import {
  createRuntimePreparationCore,
  type ExecutorRuntimeFacades,
  type ExecutorRuntimePreparationGrant,
} from "#veryfront/agent/hosted/runtime-preparation-core.ts";

export interface TrustedRuntimePreparationOptions {
  binding: ExecutorBinding;
  source: ExecutorDiscoverySource;
  channel: ExecutorChannel;
  sourceIntegrationPolicy: PreparedHostedRuntimeAgentOptions["sourceIntegrationPolicy"];
  grant: ExecutorRuntimePreparationGrant;
  projectTools: ExecutorProjectToolSource;
  facades: ExecutorRuntimeFacades;
  signal: AbortSignal;
  /** Settles only after the original project work and transport/allocation resources retire. */
  closeProject(): Promise<void>;
}

/** Trusted-only composition. Project metadata crosses the channel; project modules never load here. */
export function createTrustedRuntimePreparation(input: TrustedRuntimePreparationOptions) {
  const policy = parseSourceIntegrationPolicyManifest(
    snapshotOwnDataRecords(input.sourceIntegrationPolicy),
  );
  const { channel } = input;
  const closeProject = input.closeProject.bind(input);
  const aliases = new Map(
    input.projectTools.aliases.map(({ name, shortName }) => [shortName, name]),
  );
  const signal = AbortSignal.any([input.signal, channel.signal]);
  const tasks = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;
  return createRuntimePreparationCore({
    binding: input.binding,
    source: input.source,
    grant: input.grant,
    facades: input.facades,
    projectTools: input.projectTools,
    project: {
      signal,
      async prepare(agentId, context) {
        const deadline = new AbortController();
        const remaining = context.deadline - Date.now();
        if (remaining <= 0) throw new Error("Preparation deadline expired");
        const timer = setTimeout(() => deadline.abort(), remaining);
        try {
          const description = await channel.request("agent.describe", { agentId }, {
            signal: AbortSignal.any([context.signal, deadline.signal]),
          });
          return {
            description,
            localTools: {},
            toolAliases: aliases,
            sourceIntegrationPolicy: policy,
          };
        } finally {
          clearTimeout(timer);
        }
      },
      instantiate: (options, runtimeOptions) =>
        createPreparedHostedRuntimeAgent({
          ...options,
          runtimeAgentId: options.options.agentId,
        }, runtimeOptions),
      retainTask(task) {
        const retained = task.then(() => {}, () => {});
        tasks.add(retained);
        void retained.then(() => tasks.delete(retained));
      },
      close() {
        closing ??= (async () => {
          while (tasks.size > 0) await Promise.all(tasks);
          await closeProject();
        })();
        return closing;
      },
    },
  });
}
