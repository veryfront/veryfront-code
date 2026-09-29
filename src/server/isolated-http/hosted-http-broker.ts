import type { ExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import {
  type ExecutorHttpInstall,
  getExecutorHttpInstallSchema,
  parseExecutorInstallation,
} from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import {
  getHostedExecutorAllocationRequestSchema,
  parseHostedExecutorData,
  sameHostedExecutorOwner,
} from "#veryfront/agent/hosted/executor-session-schema.ts";
import type { HostedExecutorSessionOptions } from "#veryfront/agent/hosted/executor-session.ts";
import {
  createHostedExecutorSessionPool,
  type HostedExecutorSessionPoolOptions,
} from "#veryfront/agent/hosted/executor-session-pool.ts";
import { verifyHostedRuntimeSourceBinding } from "#veryfront/agent/hosted/runtime-source-binding.ts";
import { completeOnResponseBodyConsumption } from "#veryfront/platform/compat/http/response-lifecycle.ts";
import type { ApplicationRequestHeaderOptions } from "#veryfront/security/http/application-request.ts";
import { createExecutorHttpClient, type ExecutorHttpTracing } from "./executor-http.ts";

export { createHostedExecutorAllocatorClient } from "#veryfront/agent/hosted/executor-allocator-client.ts";
export {
  connectExecutorTransport,
  type ConnectExecutorTransportOptions,
} from "#veryfront/agent/hosted/executor-node-transport.ts";

/** Trusted ingress authority; none of these values are inferred from HTTP headers or URLs. */
export interface HostedHttpInput {
  session: Omit<HostedExecutorSessionOptions, "createOperations" | "preparationSignal">;
  installation: Omit<ExecutorHttpInstall, "binding">;
  headers?: ApplicationRequestHeaderOptions;
  tracing?: ExecutorHttpTracing;
}

/** One HTTP invocation per existing allocator session, with no shared-host fallback. */
export function createHostedHttpBroker(options: HostedExecutorSessionPoolOptions) {
  const pool = createHostedExecutorSessionPool(options);
  return {
    get active() {
      return pool.active;
    },
    get settled() {
      return pool.settled;
    },
    shutdown: pool.shutdown.bind(pool),
    async fetch(request: Request, input: HostedHttpInput): Promise<Response> {
      request.signal.throwIfAborted();
      const allocation = parseHostedExecutorData(
        getHostedExecutorAllocationRequestSchema(),
        input.session.request,
      );
      const installation = parseExecutorInstallation(getExecutorHttpInstallSchema(), {
        ...input.installation,
        // Validate before reserving capacity. The authenticated allocator's
        // actual generation replaces this validation-only value below.
        binding: {
          allocationId: allocation.allocationId,
          invocationId: allocation.invocationId,
          generation: 1,
        },
      });
      if (
        !sameHostedExecutorOwner(allocation.owner, installation.owner) ||
        verifyHostedRuntimeSourceBinding(allocation.source, installation.source) !== undefined
      ) {
        throw new TypeError("HTTP executor installation does not match its allocation");
      }
      const headerOptions = { denyHeaders: input.headers?.denyHeaders?.slice() };
      const tracing = input.tracing ? { ...input.tracing } : undefined;
      const lifetime = new AbortController();
      let channel: ExecutorChannel | undefined;
      let client: ReturnType<typeof createExecutorHttpClient> | undefined;
      const session = pool.start({
        ...input.session,
        request: allocation,
        preparationSignal: request.signal,
        createOperations(binding) {
          client = createExecutorHttpClient({
            binding: {
              allocationId: binding.allocationId,
              invocationId: binding.invocationId,
              generation: binding.generation,
            },
            channel: () => {
              if (!channel) throw new Error("HTTP executor channel is not ready");
              return channel;
            },
            ...headerOptions,
          });
          return { operations: client.operations, revoke: () => lifetime.abort() };
        },
      });
      try {
        channel = await session.ready;
        const binding = session.binding;
        if (!binding || !client) throw new Error("HTTP executor allocation is not bound");
        const acknowledged = await channel.request("runtime.install", {
          ...installation,
          binding: {
            allocationId: binding.allocationId,
            invocationId: binding.invocationId,
            generation: binding.generation,
          },
        }, { signal: session.signal });
        if (
          !acknowledged || typeof acknowledged !== "object" || Array.isArray(acknowledged) ||
          Object.keys(acknowledged).length !== 1 || acknowledged.installed !== true
        ) {
          throw new Error("HTTP executor installation acknowledgement is invalid");
        }
        session.accept({ kind: "request" });
        const signal = AbortSignal.any([request.signal, session.signal, lifetime.signal]);
        const ownedRequest = new Request(request, { signal });
        const response = await session.runOwned(() => client!.fetch(ownedRequest, tracing));
        return completeOnResponseBodyConsumption(
          response,
          () => {
            // Pool admission remains retained until session.settled, even when
            // the bounded close notification says a reaper is still required.
            void session.close(request.signal.aborted ? "canceled" : "completed").catch(() => {});
          },
          signal,
          { highWaterMark: 0 },
        );
      } catch (error) {
        await session.close("canceled");
        throw error;
      }
    },
  };
}
