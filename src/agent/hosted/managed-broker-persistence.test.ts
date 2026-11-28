import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  setGlobalTracerProvider,
  type Span,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  createManagedBrokerPersistence,
  createManagedBrokerPersistenceFromCapability,
  createManagedBrokerTerminal,
} from "./managed-broker-persistence.ts";
import { createHostedRunEventWriterCapability } from "./child-run-event-writer-token.ts";
import { createConversationHostedTerminalAdapter } from "../conversation/hosted-terminal.ts";

const run = {
  runId: "run-1",
  conversationId: "00000000-0000-4000-8000-000000000001",
  messageId: "00000000-0000-4000-8000-000000000002",
  latestEventId: 0,
  latestExternalEventSequence: 0,
  waitingToolCallId: null,
  waitingToolName: null,
  status: "running" as const,
  streamProtocolVersion: 2 as const,
};

const canonicalId = "11111111-1111-4111-8111-111111111111";
const token = (runId: string) =>
  `header.${
    btoa(
      JSON.stringify({
        runId,
        canonicalRunId: canonicalId,
        tokenUse: "run_event_writer",
        writerPurpose: "current_run_terminal",
        dispatchNonce: "generation",
      }),
    )
  }.signature`;

function authorities() {
  let effects = 0;
  const unexpected = () => {
    effects++;
    throw new Error("Configuration validation must not perform external work");
  };
  const writer = (runId = run.runId) =>
    createHostedRunEventWriterCapability({
      apiUrl: "https://api.example.test",
      runId,
      runEventAppendToken: "synthetic-event-token",
      fetch: unexpected,
    });
  return {
    writer,
    terminal: createManagedBrokerTerminal({
      apiUrl: "https://api.example.test",
      completionAuthToken: "synthetic-completion-token",
      terminalAuthToken: token(run.runId),
      run,
      modelId: "model",
      resolveProvider: unexpected,
      fetch: unexpected,
    }),
    raw: {
      apiUrl: "https://api.example.test",
      runEventToken: "synthetic-event-token",
      run,
      modelId: "model",
      resolveProvider: unexpected,
      fetch: unexpected,
    },
    assertNoEffects: () => assertEquals(effects, 0),
  };
}

describe("managed persistence authority validation", () => {
  it("rejects admission state paired with a different canonical terminal run", () => {
    const fixture = authorities();
    assertThrows(() =>
      createManagedBrokerPersistence({
        ...fixture.raw,
        run: { ...run, canonicalRunId: "22222222-2222-4222-8222-222222222222" },
        completionAuthToken: "synthetic-completion-token",
        terminalAuthToken: token(run.runId),
      })
    );
    assertThrows(() =>
      createManagedBrokerPersistenceFromCapability({
        capability: fixture.writer(),
        terminal: fixture.terminal,
        run: { ...run, canonicalRunId: "22222222-2222-4222-8222-222222222222" },
      })
    );
    assertThrows(() =>
      createManagedBrokerPersistenceFromCapability({
        capability: createHostedRunEventWriterCapability({
          apiUrl: "https://api.example.test",
          runId: run.runId,
          canonicalRunId: "22222222-2222-4222-8222-222222222222",
          runEventAppendToken: "synthetic-event-token",
        }),
        terminal: fixture.terminal,
        run: { ...run, canonicalRunId: canonicalId },
      })
    );
    fixture.assertNoEffects();
  });

  it("accepts authenticated admission state without legacy projection metadata", async () => {
    const fixture = authorities();
    const persistence = createManagedBrokerPersistence({
      ...fixture.raw,
      run: {
        canonicalRunId: canonicalId,
        runId: run.runId,
        conversationId: run.conversationId,
        messageId: run.messageId,
        latestEventId: 42,
        latestExternalEventSequence: 17,
        status: "running",
      },
      completionAuthToken: "synthetic-completion-token",
      terminalAuthToken: token(run.runId),
    });
    await persistence.cleanup();
    fixture.assertNoEffects();
  });

  it("retains snake-case projection input compatibility without a projection read", async () => {
    const fixture = authorities();
    const persistence = Reflect.apply(createManagedBrokerPersistence, undefined, [{
      ...fixture.raw,
      run: {
        run_id: run.runId,
        conversation_id: run.conversationId,
        message_id: run.messageId,
        latest_event_id: 42,
        latest_external_event_sequence: 17,
        status: "running",
      },
      completionAuthToken: "synthetic-completion-token",
      terminalAuthToken: token(run.runId),
    }]);
    await persistence.cleanup();
    fixture.assertNoEffects();
  });

  it("requires completion credentials when creating terminal authority", () => {
    const fixture = authorities();
    for (const completionAuthToken of [undefined, null, "", " "]) {
      assertThrows(
        () =>
          Reflect.apply(createManagedBrokerTerminal, undefined, [{
            ...fixture.raw,
            completionAuthToken,
          }]),
        TypeError,
        "completion authorization",
      );
    }
    fixture.assertNoEffects();
  });

  it("rejects another run's terminal capability and relabeled or cloned handles", () => {
    const fixture = authorities();
    const foreign = createManagedBrokerTerminal({
      ...fixture.raw,
      run: { ...run, runId: "foreign-run" },
      completionAuthToken: "synthetic-completion-token",
      terminalAuthToken: token("foreign-run"),
    });
    for (
      const terminal of [
        foreign,
        { ...foreign, runId: run.runId },
        { ...fixture.terminal },
        new Proxy(foreign, {
          get() {
            throw new Error("Terminal wrapper traps must not run");
          },
        }),
      ]
    ) {
      assertThrows(
        () =>
          Reflect.apply(createManagedBrokerPersistenceFromCapability, undefined, [{
            capability: fixture.writer(),
            run,
            terminal,
          }]),
        TypeError,
        "terminal authority",
      );
    }
    assertEquals(Object.isFrozen(fixture.terminal), true);
    assertEquals(JSON.stringify(fixture.terminal), '{"kind":"managed-broker-terminal"}');
    fixture.assertNoEffects();
  });

  it("rejects a run label paired with another run's completion dispatcher", () => {
    const fixture = authorities();
    const foreign = createConversationHostedTerminalAdapter({
      apiUrl: fixture.raw.apiUrl,
      authToken: "synthetic-completion-token",
      run: { ...run, runId: "foreign-run" },
      fallbackModelId: "model",
      resolveProvider: fixture.raw.resolveProvider,
      fetch: fixture.raw.fetch,
    });
    assertThrows(
      () =>
        Reflect.apply(createManagedBrokerPersistenceFromCapability, undefined, [{
          capability: fixture.writer(),
          run,
          terminal: { runId: run.runId, dispatch: foreign.dispatch },
        }]),
      TypeError,
      "terminal authority",
    );
    fixture.assertNoEffects();
  });
  it("requires an independent completion credential before creating raw-token persistence", () => {
    const fixture = authorities();
    for (const completionAuthToken of [undefined, null, "", " ", "synthetic-event-token"]) {
      assertThrows(
        () =>
          Reflect.apply(createManagedBrokerPersistence, undefined, [{
            ...fixture.raw,
            completionAuthToken,
          }]),
        TypeError,
        "independent completion",
      );
    }
    fixture.assertNoEffects();
  });

  it("requires a same-run terminal adapter before accepting append authority", () => {
    const fixture = authorities();
    const capability = fixture.writer();
    for (
      const terminal of [undefined, {}, { runId: run.runId }, {
        ...fixture.terminal,
        runId: "foreign-run",
      }]
    ) {
      assertThrows(
        () =>
          Reflect.apply(createManagedBrokerPersistenceFromCapability, undefined, [{
            capability,
            run,
            terminal,
          }]),
        TypeError,
        "terminal authority",
      );
    }
    fixture.assertNoEffects();
  });

  it("rejects missing, fabricated and foreign-run append authority before external work", () => {
    const fixture = authorities();
    for (const capability of [undefined, {}, fixture.writer("foreign-run")]) {
      assertThrows(
        () =>
          Reflect.apply(createManagedBrokerPersistenceFromCapability, undefined, [{
            capability,
            run,
            terminal: fixture.terminal,
          }]),
        TypeError,
        "run-event capability is not bound",
      );
    }
    fixture.assertNoEffects();
  });

  it("rejects already-terminal run projections before external work", () => {
    const fixture = authorities();
    for (const status of ["completed", "failed", "cancelled"] as const) {
      assertThrows(
        () =>
          createManagedBrokerPersistenceFromCapability({
            capability: fixture.writer(),
            run: { ...run, status },
            terminal: fixture.terminal,
          }),
        TypeError,
        "active run",
      );
    }
    fixture.assertNoEffects();
  });

  it("keeps valid construction and cleanup inert until session-owned operations are requested", async () => {
    const fixture = authorities();
    const persistence = createManagedBrokerPersistenceFromCapability({
      capability: fixture.writer(),
      run,
      terminal: fixture.terminal,
    });
    await persistence.cleanup();
    fixture.assertNoEffects();
  });
});

describe("managed persistence trace propagation", () => {
  afterEach(() => {
    _resetShimForTests();
  });

  it("flushes paused output without dispatching a terminal outcome", async () => {
    const requests: string[] = [];
    const persistence = createManagedBrokerPersistence({
      apiUrl: "https://api.example.test",
      runEventToken: "synthetic-event-token",
      completionAuthToken: "synthetic-completion-token",
      terminalAuthToken: token(run.runId),
      run,
      modelId: "model",
      resolveProvider: () => "provider",
      fetch: ((input: RequestInfo | URL) => {
        requests.push(String(input));
        return Promise.resolve(Response.json({}));
      }) as typeof globalThis.fetch,
    });
    persistence.bindSessionOwnedWork((operation) => operation());
    await persistence.output.finish({ completed: false, paused: true });
    await persistence.cleanup();
    assertEquals(requests, []);
  });

  it("keeps the trusted completion transport in the active execution trace", async () => {
    const span: Span = {
      setAttribute: () => span,
      setAttributes: () => span,
      setStatus: () => span,
      recordException: () => undefined,
      addEvent: () => span,
      end: () => undefined,
      spanContext: () => ({ traceId: "1".repeat(32), spanId: "2".repeat(16), traceFlags: 1 }),
      updateName: () => undefined,
    };
    setGlobalTracerProvider({
      getTracer: () => ({
        startSpan: () => span,
        startActiveSpan: ((...args: unknown[]) => {
          const callback = args.find((arg) => typeof arg === "function") as
            | ((activeSpan: Span) => unknown)
            | undefined;
          if (!callback) throw new Error("Expected tracing callback");
          return callback(span);
        }) as never,
      }),
    });
    const requests: Request[] = [];
    const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Promise.resolve(Response.json({
        id: canonicalId,
        status: "completed",
      }));
    }) as typeof globalThis.fetch;
    const persistence = createManagedBrokerPersistence({
      apiUrl: "https://api.example.test",
      runEventToken: "synthetic-event-token",
      completionAuthToken: "synthetic-completion-token",
      terminalAuthToken: token(run.runId),
      run,
      modelId: "model",
      resolveProvider: () => "provider",
      fetch,
    });
    persistence.bindSessionOwnedWork((operation) => operation());

    await persistence.output.finish({ completed: true });
    await persistence.cleanup();

    assertEquals(requests.map((request) => `${request.method} ${request.url}`), [
      `POST https://api.example.test/runs/${canonicalId}/finalize`,
    ]);
    assertEquals(requests[0]?.headers.get("Authorization"), "Bearer synthetic-completion-token");
    assertEquals(
      requests[0]?.headers.get("traceparent"),
      "00-11111111111111111111111111111111-2222222222222222-01",
    );
  });
});

describe("captured persistence configuration reference", () => {
  it("snapshots trusted admission provenance and restores the same reference across reconstruction", async () => {
    const fixture = authorities();
    const reference = {
      version: 1 as const,
      projectId: "10000000-1000-4000-8000-100000000001",
      environmentId: "20000000-2000-4000-8000-200000000002",
      releaseId: "30000000-3000-4000-8000-300000000003",
      deploymentId: "40000000-4000-4000-8000-400000000004",
      configurationId: `configuration-${"a".repeat(64)}`,
    };
    const saved = { ...run, runtimeConfiguration: reference };
    const create = (snapshot: typeof saved) =>
      createManagedBrokerPersistence({
        ...fixture.raw,
        run: snapshot,
        completionAuthToken: "synthetic-completion-token",
        terminalAuthToken: token(run.runId),
      });
    const first = create(saved);
    const serialized = JSON.stringify(saved);
    reference.configurationId = `configuration-${"b".repeat(64)}`;
    const restored = create(JSON.parse(serialized));
    try {
      assertEquals(first.runtimeConfiguration, restored.runtimeConfiguration);
      assertEquals(first.runtimeConfiguration?.configurationId, `configuration-${"a".repeat(64)}`);
      assertEquals(Object.isFrozen(first.runtimeConfiguration), true);
      fixture.assertNoEffects();
    } finally {
      await first.cleanup();
      await restored.cleanup();
    }
  });
  it("rejects malformed or accessor-backed configuration provenance before persistence effects", () => {
    const fixture = authorities();
    let reads = 0;
    for (
      const snapshot of [{ ...run, runtimeConfiguration: {} }, {
        ...run,
        get runtimeConfiguration() {
          reads++;
          return {};
        },
      }]
    ) {
      assertThrows(() =>
        createManagedBrokerPersistence({
          ...fixture.raw,
          run: snapshot as never,
          completionAuthToken: "synthetic-completion-token",
          terminalAuthToken: token(run.runId),
        })
      );
    }
    assertEquals(reads, 0);
    fixture.assertNoEffects();
  });
});
