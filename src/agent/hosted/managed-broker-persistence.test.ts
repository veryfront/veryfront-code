import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createManagedBrokerPersistence,
  createManagedBrokerPersistenceFromCapability,
} from "./managed-broker-persistence.ts";
import { createHostedRunEventWriterCapability } from "./child-run-event-writer-token.ts";

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
    terminal: { runId: run.runId, dispatch: unexpected },
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
