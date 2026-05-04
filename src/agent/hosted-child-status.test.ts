import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  hostedChildTerminalErrorCodes,
  HostedChildTerminalStateError,
  isHostedChildTerminalErrorCode,
  monitorHostedChildRunStatus,
  resolveHostedChildTerminalErrorCode,
} from "./hosted-child-status.ts";

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
