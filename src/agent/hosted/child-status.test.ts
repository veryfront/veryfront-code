import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  hostedChildTerminalErrorCodes,
  HostedChildTerminalStateError,
  isHostedChildTerminalErrorCode,
  monitorHostedChildRunStatus,
  resolveHostedChildTerminalErrorCode,
  shouldBlockHostedChildSameTurnRetry,
} from "./child-status.ts";
import { shouldBlockHostedChildSameTurnRetry as shouldBlockHostedChildSameTurnRetryFromIndex } from "../index.ts";

describe("agent/hosted-child-status", () => {
  it("maps terminal statuses to durable child error codes", () => {
    assertEquals(
      resolveHostedChildTerminalErrorCode("cancelled"),
      hostedChildTerminalErrorCodes.cancelled,
    );
    assertEquals(
      resolveHostedChildTerminalErrorCode("failed"),
      hostedChildTerminalErrorCodes.failed,
    );
    assertEquals(
      resolveHostedChildTerminalErrorCode("completed"),
      hostedChildTerminalErrorCodes.completedExternally,
    );
  });

  it("recognizes hosted child terminal error codes", () => {
    assertEquals(isHostedChildTerminalErrorCode(hostedChildTerminalErrorCodes.cancelled), true);
    assertEquals(isHostedChildTerminalErrorCode(hostedChildTerminalErrorCodes.failed), true);
    assertEquals(
      isHostedChildTerminalErrorCode(hostedChildTerminalErrorCodes.completedExternally),
      true,
    );
    assertEquals(isHostedChildTerminalErrorCode("OTHER"), false);
    assertEquals(isHostedChildTerminalErrorCode(null), false);
  });

  it("detects child cancellation results that should block same-turn retries", () => {
    assertEquals(
      shouldBlockHostedChildSameTurnRetry({
        terminalErrorCode: "CANCELLED",
        terminalErrorMessage: "Run cancelled by host",
      }),
      true,
    );
    assertEquals(
      shouldBlockHostedChildSameTurnRetry({
        terminalErrorCode: hostedChildTerminalErrorCodes.cancelled,
      }),
      true,
    );
    // Message-only objects without a structured terminalErrorCode are not blocked —
    // the code-based check is the authoritative signal; message text is unstable.
    assertEquals(
      shouldBlockHostedChildSameTurnRetry({
        terminalErrorMessage: "Child run cancelled",
      }),
      false,
    );
    assertEquals(
      shouldBlockHostedChildSameTurnRetry({
        terminalErrorCode: "INVOKE_AGENT_FAILED",
        terminalErrorMessage: "Child run failed",
      }),
      false,
    );
    assertEquals(shouldBlockHostedChildSameTurnRetry(null), false);
  });

  it("stores status and identifiers on HostedChildTerminalStateError", () => {
    const error = new HostedChildTerminalStateError("failed", {
      childConversationId: "11111111-1111-4111-a111-111111111111",
      childRunId: "run_123",
      childMessageId: "22222222-2222-4222-a222-222222222222",
      latestEventId: 1,
      latestExternalEventSequence: 0,
    });

    assertEquals(error.status, "failed");
    assertEquals(error.name, "HostedChildTerminalStateError");
    assertEquals(error.identifiers.childRunId, "run_123");
  });

  it("returns immediately when already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();
    let calls = 0;

    await monitorHostedChildRunStatus({
      authToken: "token",
      apiUrl: "https://api.example.com",
      identifiers: {
        childConversationId: "11111111-1111-4111-a111-111111111111",
        childRunId: "run_123",
        childMessageId: "22222222-2222-4222-a222-222222222222",
        latestEventId: 1,
        latestExternalEventSequence: 0,
      },
      abortSignal: abortController.signal,
      pollIntervalMs: 1,
      onTerminal: () => {
        calls += 1;
      },
    });

    assertEquals(calls, 0);
  });

  it("reports the observed terminal status once after polling through active states", async () => {
    let pollAttempts = 0;
    let exhaustedCalls = 0;
    const terminalErrors: HostedChildTerminalStateError[] = [];
    const projection = (status: string) =>
      new Response(
        JSON.stringify({
          runId: "run_123",
          conversationId: "11111111-1111-4111-a111-111111111111",
          messageId: "22222222-2222-4222-a222-222222222222",
          latestEventId: 1,
          latestExternalEventSequence: 0,
          status,
          projectId: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    await withMockFetch(
      () => {
        pollAttempts++;
        if (pollAttempts === 1) {
          return Promise.resolve(projection("running"));
        }
        if (pollAttempts === 2) {
          return Promise.reject(new Error("blip"));
        }
        return Promise.resolve(projection("cancelled"));
      },
      () =>
        monitorHostedChildRunStatus({
          authToken: "token",
          apiUrl: "https://api.example.com",
          identifiers: {
            childConversationId: "11111111-1111-4111-a111-111111111111",
            childRunId: "run_123",
            childMessageId: "22222222-2222-4222-a222-222222222222",
            latestEventId: 1,
            latestExternalEventSequence: 0,
          },
          pollIntervalMs: 0,
          onTerminal: (error) => {
            terminalErrors.push(error);
          },
          onMonitoringExhausted: () => {
            exhaustedCalls++;
          },
        }),
    );

    assertEquals(terminalErrors.length, 1, "terminal state must be reported exactly once");
    assertInstanceOf(terminalErrors[0], HostedChildTerminalStateError);
    assertEquals(
      terminalErrors[0].status,
      "cancelled",
      "the observed terminal status must be forwarded",
    );
    assertEquals(
      terminalErrors[0].identifiers.childRunId,
      "run_123",
      "identifiers must be forwarded",
    );
    assertEquals(
      exhaustedCalls,
      0,
      "a transient failure between successful polls must not exhaust the monitor",
    );
    assertEquals(pollAttempts, 3, "polling must stop after the terminal projection");
  });

  it("reports polling exhaustion separately from an observed terminal state", async () => {
    let pollAttempts = 0;
    let terminalCalls = 0;
    let monitoringError: Error | undefined;

    await withMockFetch(
      () => {
        pollAttempts++;
        return Promise.reject(new Error("control plane unavailable"));
      },
      () =>
        monitorHostedChildRunStatus({
          authToken: "token",
          apiUrl: "https://api.example.com",
          identifiers: {
            childConversationId: "11111111-1111-4111-a111-111111111111",
            childRunId: "run_123",
            childMessageId: "22222222-2222-4222-a222-222222222222",
            latestEventId: 1,
            latestExternalEventSequence: 0,
          },
          pollIntervalMs: 0,
          onTerminal: () => {
            terminalCalls++;
          },
          onMonitoringExhausted: (error) => {
            monitoringError = error;
          },
        }),
    );

    assertEquals(pollAttempts, 5);
    assertEquals(terminalCalls, 0);
    assertInstanceOf(monitoringError, Error);
    assertEquals(monitoringError instanceof HostedChildTerminalStateError, false);
  });
});

describe("agent/hosted-child-status public contract", () => {
  it("exports same-turn retry block detection from veryfront/agent", () => {
    assertEquals(
      shouldBlockHostedChildSameTurnRetryFromIndex({
        terminalErrorCode: hostedChildTerminalErrorCodes.cancelled,
      }),
      true,
    );
  });
});
