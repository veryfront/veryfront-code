import { createExecutorChannel, type ExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import { createExecutorRuntimeInstallation } from "#veryfront/agent/hosted/executor-runtime-install.ts";
import type { HostedExecutorAllocation } from "#veryfront/agent/hosted/executor-session-schema.ts";
import type { HostedExecutorSessionOptions } from "#veryfront/agent/hosted/executor-session.ts";
import { createExecutorHttpOperation } from "#veryfront/server/isolated-http/executor-http.ts";
import type { ExecutorHttpInstall } from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import type { HostedHttpInput } from "veryfront/server/http-broker";

export function createHostedHttpFixture(
  handle: (request: Request) => Promise<Response> | Response,
  onInstall?: (peer: ExecutorChannel, installation: ExecutorHttpInstall) => Promise<void>,
  projectId = "project-a",
) {
  const now = Date.now();
  const owner = { scopeKind: "project" as const, projectId };
  const source = { type: "release" as const, releaseId: "release-a" };
  const image = `registry.example/executor@sha256:${"a".repeat(64)}`;
  const request = {
    allocationId: crypto.randomUUID(),
    invocationId: crypto.randomUUID(),
    owner,
    source,
    requestedAt: now,
    prepareDeadlineAt: now + 5000,
    hardDeadlineAt: now + 30_000,
  };
  const binding = { ...request, generation: 1, brokerInstanceId: "broker-a" };
  const calls: string[] = [];
  const releaseEntered = Promise.withResolvers<void>();
  const releaseAllowed = Promise.withResolvers<void>();
  let holdRelease = false;
  let peer: ExecutorChannel | undefined;
  function view(
    phase: "ready" | "released",
    reason?: "completed" | "canceled",
  ): HostedExecutorAllocation {
    return {
      binding: {
        allocationId: binding.allocationId,
        invocationId: binding.invocationId,
        generation: 1,
        brokerInstanceId: binding.brokerInstanceId,
        owner,
        source,
        executionProfile: "http",
      },
      phase,
      expiresAt: now + 30_000,
      ...(phase === "ready"
        ? {
          endpoint: {
            address: "127.0.0.1",
            port: 8081 as const,
            podUid: "pod-a",
            nodeName: "node-a",
            image,
            channelAuthenticated: false as const,
          },
        }
        : { reason }),
    };
  }
  const session: Omit<HostedExecutorSessionOptions, "createOperations" | "preparationSignal"> = {
    request,
    expectedImage: image,
    expectedBrokerInstanceId: "broker-a",
    allocator: {
      allocate: () => {
        calls.push("allocate");
        return Promise.resolve(view("ready"));
      },
      observe: () => Promise.resolve(view("ready")),
      renew: () => Promise.resolve(view("ready")),
      async release(_binding, reason) {
        calls.push(`release:${reason}`);
        releaseEntered.resolve();
        if (holdRelease) await releaseAllowed.promise;
        return view("released", reason);
      },
    },
    connectTransport(input) {
      const forward = new TransformStream<Uint8Array>();
      const backward = new TransformStream<Uint8Array>();
      const retired = Promise.withResolvers<void>();
      const installation = createExecutorRuntimeInstallation({
        mode: "http",
        binding: input.binding,
        artifact: { version: 1, owner, source, root: "project" },
        async install(installed) {
          calls.push("install");
          await onInstall?.(peer!, installed);
          return {
            operations: new Map([[
              "http.request",
              createExecutorHttpOperation({ binding: input.binding, channel: () => peer!, handle }),
            ]]),
            close: () => {
              retired.resolve();
              return Promise.resolve();
            },
            settled: retired.promise,
          };
        },
      });
      peer = createExecutorChannel({
        binding: input.binding,
        transport: { readable: forward.readable, writable: backward.writable },
        operations: installation.operations,
      });
      void peer.closed.then(() => installation.close());
      return Promise.resolve({
        readable: backward.readable,
        writable: forward.writable,
        close: () => peer?.close(),
      });
    },
  };
  const input: HostedHttpInput = {
    session,
    installation: {
      version: 1,
      mode: "http",
      owner,
      source,
      root: "project",
      environmentId: "environment-a",
      configurationId: "config-a",
    },
  };
  return {
    input,
    calls,
    releaseEntered,
    releaseAllowed,
    holdRelease() {
      holdRelease = true;
    },
  };
}
