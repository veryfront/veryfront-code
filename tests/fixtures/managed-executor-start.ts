import type { ManagedExecutorStartInput } from "#veryfront/agent/hosted/managed-executor-broker.ts";

export function managedStart(
  prepare: ManagedExecutorStartInput["prepare"],
): ManagedExecutorStartInput {
  const unavailable = () => Promise.reject(new Error("Unused test executor dependency"));
  const owner = { scopeKind: "global" as const, serviceName: "test-service" };
  const source = { type: "release" as const, releaseId: "release-1" };
  const modelId = "veryfront-cloud/openai/synthetic";
  return {
    session: {
      request: {
        allocationId: "allocation-1",
        invocationId: "invocation-1",
        owner,
        source,
        requestedAt: 1_000,
        prepareDeadlineAt: 2_000,
        hardDeadlineAt: 3_000,
      },
      expectedBrokerInstanceId: "broker-test",
      expectedImage: "registry.test/executor@sha256:" + "a".repeat(64),
      allocator: {
        allocate: unavailable,
        observe: unavailable,
        renew: unavailable,
        release: unavailable,
      },
      connectTransport: unavailable,
    },
    installation: {
      version: 1,
      owner,
      source,
      root: "project",
      grant: {
        agentId: "builder",
        defaultModelId: modelId,
        maxSteps: 5,
        models: [{ id: modelId, maxOutputTokens: 100, providerToolNames: [] }],
        allowedToolNames: [],
        hostToolFacadeIds: [],
        remoteToolSourceIds: [],
        execution: { kind: "ephemeral", projectId: null },
      },
      capabilities: { persistence: {} },
    },
    prepare,
    model: {
      resolver: () => undefined,
      grant: {
        maxCalls: 1,
        maxConcurrentCalls: 1,
        models: new Map([[modelId, { maxOutputTokens: 100, providerTools: [] }]]),
      },
    },
    tools: { catalog: new Map(), sources: new Map(), maxCalls: 1, maxConcurrent: 1 },
    persistence: {},
    state: {},
  };
}
