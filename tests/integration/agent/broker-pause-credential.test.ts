import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { parseBrokerRuntimeAgentIngress } from "#veryfront/agent/service/broker-ingress.ts";
import { options, signedRequest } from "#veryfront/agent/service/broker-ingress.test-helpers.ts";
import {
  activateHostedAgentPauseCapability,
  createRunBoundAgentManualPause,
  getHostedAgentPauseCreationOptions,
  inheritHostedAgentPauseCapability,
} from "#veryfront/agent/hosted/manual-pause-credential.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  createHostedChatExecutionRuntime,
  createHostedChatExecutionRuntimeBootstrap,
} from "#veryfront/agent/hosted/chat-execution-runtime.ts";
import type { HostedChatExecutionLifecycleAdapter } from "#veryfront/agent/hosted/chat-execution-lifecycle-types.ts";
import { createMirroredToolChunkState } from "#veryfront/agent/streaming/mirrored-tool-chunk-state.ts";
import type { AgentPauseCheckpoint } from "#veryfront/agent/runtime/manual-pause.ts";

it("carries the signed ingress stop token privately into runtime creation", async () => {
  const signed = await signedRequest();
  signed.request.headers.set("x-veryfront-run-stop-token", "synthetic-stop-token");
  const ingress = await parseBrokerRuntimeAgentIngress(
    signed.request,
    options(signed.publicKeyPem),
  );
  const prepared = {};
  const runtimeOptions = {};
  inheritHostedAgentPauseCapability(prepared, ingress);
  inheritHostedAgentPauseCapability(runtimeOptions, prepared);
  assertEquals(JSON.stringify(ingress).includes("synthetic-stop-token"), false);
  await withMockFetch((url, init) => {
    assertEquals(new URL(String(url)).pathname, "/runs/run-1/pause-checkpoint");
    assertEquals(new Headers(init?.headers).get("Authorization"), "Bearer synthetic-stop-token");
    return Promise.resolve(Response.json({ stop: false, checkpoint: null }));
  }, async () => {
    const pause = activateHostedAgentPauseCapability(runtimeOptions, AbortSignal.timeout(3000));
    assertEquals(pause !== undefined, true);
    assertEquals(getHostedAgentPauseCreationOptions(runtimeOptions), pause);
    assertEquals(await pause!.load(), null);
  });
});

it("binds a deferred cloud pause before streaming and stops it with the watchdog", async () => {
  const execution = new AbortController();
  const watchdog = new AbortController();
  let requests = 0;
  const pause = createRunBoundAgentManualPause({
    apiUrl: "https://api.example.com",
    runId: "run-1",
    token: "synthetic-stop-token",
    signal: undefined,
    fetch: (_url, init) => {
      requests++;
      assertEquals(init?.signal?.aborted, false);
      return Promise.resolve(Response.json({ stop: false, checkpoint: null }));
    },
  });
  const lifecycle: HostedChatExecutionLifecycleAdapter = {
    durableRootRun: null,
    durableRunMirror: null,
    terminal: {
      toTerminalState: (state) => state,
      finalizeRun: async () => {},
      cancelRun: async () => {},
      onTerminalState: async () => {},
    },
  };
  inheritHostedAgentPauseCapability(lifecycle, pause);
  const bootstrap = await createHostedChatExecutionRuntimeBootstrap({
    agent: {
      stream: async ({ abortSignal }) => {
        assertEquals(abortSignal?.aborted, false);
        assertEquals(await pause.load(), null);
        return { steps: Promise.resolve([]), toUIMessageStream: async function* () {} };
      },
    },
    cleanup: async () => {},
    lifecycleAdapter: lifecycle,
    finalMessages: [],
    abortSignal: execution.signal,
    createRootStreamWatchdog: () => ({
      signal: watchdog.signal,
      lastTimeoutState: null,
      keepAlive: () => {},
      observe: () => {},
      dispose: () => {},
    }),
  });
  try {
    assertEquals(requests, 1);
    assertEquals(await pause.load(), null);
    watchdog.abort();
    await assertRejects(() => pause.load(), Error, "manual pause boundary");
    assertEquals(requests, 2);
  } finally {
    await bootstrap.cleanup();
    bootstrap.rootStreamWatchdog.dispose();
  }
});

it("keeps an acknowledged broker pause nonterminal through waitForFinish", async () => {
  const signed = await signedRequest();
  signed.request.headers.set("x-veryfront-run-stop-token", "synthetic-stop-token");
  const ingress = await parseBrokerRuntimeAgentIngress(
    signed.request,
    options(signed.publicKeyPem),
  );
  const terminalStates: unknown[] = [];
  const lifecycle: HostedChatExecutionLifecycleAdapter = {
    durableRootRun: { runId: "run-1", messageId: "message-1" },
    durableRunMirror: null,
    terminal: {
      toTerminalState: (state) => state,
      finalizeRun: async (state) => {
        terminalStates.push(state);
      },
      cancelRun: async (state) => {
        terminalStates.push(state);
      },
      onTerminalState: async () => {},
    },
  };
  inheritHostedAgentPauseCapability(lifecycle, ingress);
  const signal = new AbortController().signal;
  const checkpoint: AgentPauseCheckpoint = {
    version: 1,
    nextStep: 1,
    messages: [],
    toolCalls: [],
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    latestAssistantText: "",
    completed: false,
    recoveredEmptyResponse: false,
    recoveredInterruptedLocalToolBatch: false,
  };
  let cleaned = 0;
  let disposed = 0;
  await withMockFetch(() => Promise.resolve(Response.json({ stop: true })), async () => {
    const pause = activateHostedAgentPauseCapability(lifecycle, signal)!;
    const runtime = createHostedChatExecutionRuntime({
      agentId: "agent-1",
      modelId: "test/pause",
      originalMessages: [],
      runContext: { withContext: (operation) => operation() },
      abortSignal: signal,
      bootstrap: {
        cleanup: async () => {
          cleaned++;
        },
        lifecycleAdapter: lifecycle,
        rootStreamWatchdog: {
          signal,
          lastTimeoutState: null,
          keepAlive: () => {},
          observe: () => {},
          dispose: () => {
            disposed++;
          },
        },
        streamResult: {
          steps: Promise.resolve([]),
          toUIMessageStream: async function* () {
            yield { type: "text-delta" as const, id: "message-1", delta: "Settled output" };
            assertEquals(await pause.acknowledge(checkpoint), true);
          },
        },
        streamingMessageId: "message-1",
        capturedMessageId: "message-1",
        capturedConversationId: "conversation-1",
        mirroredToolChunkState: createMirroredToolChunkState(),
      },
    });
    for await (const _chunk of runtime.agentUIStream) { /* paused stream has no terminal chunk */ }
    await runtime.waitForFinish();
  });
  assertEquals(terminalStates, []);
  assertEquals(cleaned, 1);
  assertEquals(disposed, 2);
});
