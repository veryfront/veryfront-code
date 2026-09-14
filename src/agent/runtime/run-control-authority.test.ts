import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RunResumeSessionManager } from "./resume-session.ts";
import {
  authorizeRunControl,
  RunControlAuthorityError,
  type RunControlOperation,
  type VerifiedRunControlAuthority,
} from "./run-control-authority.ts";
import { createAgUiCancelHandler, createAgUiResumeHandler } from "../ag-ui/run-control.ts";

const RUN_ID = "run_owned";
const OTHER_RUN_ID = "run_other";

function controlRequest(runId: string, operation: RunControlOperation): Request {
  return operation === "cancel"
    ? new Request(`https://runtime.example.test/api/runs/${runId}`, { method: "DELETE" })
    : new Request(`https://runtime.example.test/api/runs/${runId}/resume`, {
      method: "POST",
      body: JSON.stringify({ type: "tool_result", toolCallId: "tool_1", result: { ok: true } }),
      headers: { "content-type": "application/json" },
    });
}

async function grant(
  runId: string,
  operation: RunControlOperation,
): Promise<VerifiedRunControlAuthority> {
  const authority = await authorizeRunControl(() => true, {
    request: controlRequest(runId, operation),
    runId,
    operation,
  });
  assertExists(authority, "the test authorizer must grant authority");
  return authority;
}

function startedManager(): RunResumeSessionManager<{ result: unknown; isError: boolean }> {
  const manager = new RunResumeSessionManager<{ result: unknown; isError: boolean }>();
  manager.startRun({ runId: RUN_ID, threadId: crypto.randomUUID() });
  void manager.waitForSignal(RUN_ID, "tool_1").catch(() => undefined);
  return manager;
}

describe("agent/run-control-authority", () => {
  it("refuses a structurally identical authority the authorizer never minted", async () => {
    const manager = startedManager();
    // The brand makes this uncompilable without a cast; the WeakSet makes the
    // cast fail at runtime too, so a forged object is not authority.
    const forged = { runId: RUN_ID, operation: "cancel" } as unknown as VerifiedRunControlAuthority;

    assertThrows(() => manager.cancelRunWithAuthority(forged), RunControlAuthorityError);
    assertEquals(manager.getRunStatus(RUN_ID), "waiting");

    const authority = await grant(RUN_ID, "cancel");
    assertEquals(manager.cancelRunWithAuthority(authority), true);
  });

  it("refuses authority minted for a different operation", async () => {
    const manager = startedManager();
    const resumeAuthority = await grant(RUN_ID, "resume");

    assertThrows(
      () => manager.cancelRunWithAuthority(resumeAuthority),
      RunControlAuthorityError,
      'cannot perform "cancel"',
    );
    assertEquals(manager.getRunStatus(RUN_ID), "waiting");

    const cancelAuthority = await grant(RUN_ID, "cancel");
    assertThrows(
      () =>
        manager.submitSignalWithAuthority(cancelAuthority, {
          waitKey: "tool_1",
          value: { result: { ok: true }, isError: false },
        }),
      RunControlAuthorityError,
      'cannot perform "resume"',
    );
    manager.reset();
  });

  it("performs the effect on the run the authority names, never on a caller-supplied id", async () => {
    const manager = startedManager();
    manager.startRun({ runId: OTHER_RUN_ID, threadId: crypto.randomUUID() });

    const authority = await grant(OTHER_RUN_ID, "cancel");
    assertEquals(manager.cancelRunWithAuthority(authority), true);

    assertEquals(manager.getRunStatus(OTHER_RUN_ID), null);
    assertEquals(manager.getRunStatus(RUN_ID), "waiting");
    manager.reset();
  });

  it("denies control when the authorizer refuses, throws, or answers with a non-boolean", async () => {
    for (
      const authorize of [
        () => false,
        () => {
          throw new Error("verifier unavailable");
        },
        () => "true" as unknown as boolean,
        () => Promise.reject(new Error("verifier unavailable")),
        undefined,
      ]
    ) {
      assertEquals(
        await authorizeRunControl(authorize, {
          request: controlRequest(RUN_ID, "cancel"),
          runId: RUN_ID,
          operation: "cancel",
        }),
        null,
      );
    }
  });

  it("does not create a delayed-start tombstone for an unauthorized cancel", async () => {
    const manager = new RunResumeSessionManager<{ result: unknown; isError: boolean }>();
    const handler = createAgUiCancelHandler({
      sessionManager: manager,
      authorizeRunControl: () => false,
    });

    assertEquals((await handler(controlRequest("run_never_started", "cancel"))).status, 403);

    // A tombstone would have rejected this start. Cancel-before-start must stay
    // available to an authorized caller and unavailable to everyone else.
    const signal = manager.startRun({ runId: "run_never_started", threadId: crypto.randomUUID() });
    assertEquals(signal.aborted, false);
  });

  it("creates the delayed-start tombstone for an authorized cancel", async () => {
    const manager = new RunResumeSessionManager<{ result: unknown; isError: boolean }>();
    const handler = createAgUiCancelHandler({
      sessionManager: manager,
      authorizeRunControl: () => true,
    });

    assertEquals((await handler(controlRequest("run_delayed", "cancel"))).status, 204);
    assertThrows(
      () => manager.startRun({ runId: "run_delayed", threadId: crypto.randomUUID() }),
      Error,
      "cancelled before start",
    );
  });

  it("refuses a resume the authorizer denies and leaves the run waiting", async () => {
    const manager = startedManager();
    const handler = createAgUiResumeHandler({
      sessionManager: manager,
      authorizeRunControl: () => false,
    });

    assertEquals((await handler(controlRequest(RUN_ID, "resume"))).status, 403);
    assertEquals(manager.getRunStatus(RUN_ID), "waiting");
    manager.reset();
  });

  it("authorizes control per run, so authority over one run does not reach another", async () => {
    const manager = startedManager();
    manager.startRun({ runId: OTHER_RUN_ID, threadId: crypto.randomUUID() });
    const handler = createAgUiCancelHandler({
      sessionManager: manager,
      // Stands in for a verifier that answers for the exact run the bearer names.
      authorizeRunControl: ({ runId }) => runId === OTHER_RUN_ID,
    });

    assertEquals((await handler(controlRequest(RUN_ID, "cancel"))).status, 403);
    assertEquals(manager.getRunStatus(RUN_ID), "waiting");
    assertEquals((await handler(controlRequest(OTHER_RUN_ID, "cancel"))).status, 202);
    assertEquals(manager.getRunStatus(OTHER_RUN_ID), null);
    manager.reset();
  });

  it("denies malformed resume input without parsing it or changing the waiting run", async () => {
    const manager = startedManager();
    const handler = createAgUiResumeHandler({
      sessionManager: manager,
      authorizeRunControl: () => false,
    });
    const request = new Request(`https://runtime.example.test/api/runs/${RUN_ID}/resume`, {
      method: "POST",
      body: "{ invalid JSON",
      headers: { "content-type": "application/json" },
    });

    assertEquals((await handler(request)).status, 403);
    assertEquals(manager.getRunStatus(RUN_ID), "waiting");
    manager.reset();
  });
});
