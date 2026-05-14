import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
    assertEquals(
      shouldBlockHostedChildSameTurnRetry({
        terminalErrorMessage: "Child run cancelled",
      }),
      true,
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
