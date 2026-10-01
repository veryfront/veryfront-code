import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ToolExecutionContext } from "#veryfront/tool/types.ts";
import {
  awaitTerminalRunControl,
  createTerminalRunControl,
  dispatchWithTerminalRunControl,
  executeTerminalRunTool,
  isTerminalRunControlError,
  terminalCompletionResponse,
  TerminalRunControlError,
} from "./terminal-run-control.ts";

Deno.test("a sibling that passed its initial check cannot dispatch during finalization", async () => {
  const control = createTerminalRunControl({ runId: "run-current" });
  const context = { ...control.context, abortSignal: control.signal } as ToolExecutionContext;
  await awaitTerminalRunControl(context);
  let reply!: (value: unknown) => void;
  const pendingReply = new Promise((resolve) => reply = resolve);
  const terminal = executeTerminalRunTool(
    "veryfront__finalized",
    { status: "completed", output: { count: 3 } },
    context,
    () => pendingReply,
  );
  let dispatched = 0;
  const sibling = dispatchWithTerminalRunControl(context, async () => ++dispatched);
  await Promise.resolve();
  assertEquals(dispatched, 0);
  const terminalRejection = assertRejects(() => terminal);
  const siblingRejection = assertRejects(() => sibling);
  reply({ run: { run_id: "run-current", status: "completed", output: { count: 3 } } });
  await Promise.all([terminalRejection, siblingRejection]);
  assertEquals(dispatched, 0);
});

for (const status of ["completed", "failed"] as const) {
  Deno.test(`finalization requests cancellation of an in-flight sibling without undoing its effect: ${status}`, async () => {
    const control = createTerminalRunControl({ runId: "run-current" });
    const context = { ...control.context, abortSignal: control.signal } as ToolExecutionContext;
    let started!: () => void;
    const running = new Promise<void>((resolve) => started = resolve);
    let committedEffects = 0;
    let observedAbort = false;
    const sibling = dispatchWithTerminalRunControl(context, () => {
      committedEffects++;
      started();
      return new Promise<void>((resolve) => {
        control.signal.addEventListener("abort", () => {
          observedAbort = true;
          resolve();
        }, { once: true });
      });
    });
    await running;
    assertEquals(observedAbort, false);
    const outcome = status === "completed"
      ? { status, output: { count: 1 } }
      : { status, error: { code: "INGEST_FAILED", message: "no email ingested" } };
    await assertRejects(() =>
      executeTerminalRunTool(
        "veryfront__finalized",
        outcome,
        context,
        async () => ({ run: { run_id: "run-current", ...outcome } }),
      )
    );
    assertEquals(observedAbort, true);
    await sibling;
    assertEquals(committedEffects, 1);
    await assertRejects(() =>
      dispatchWithTerminalRunControl(context, async () => ++committedEffects)
    );
    assertEquals(committedEffects, 1);
  });
}

it("invalid terminal requests leave the dispatch gate usable", async () => {
  const control = createTerminalRunControl({ runId: "run-current" });
  const context = { ...control.context, abortSignal: control.signal } as ToolExecutionContext;
  let calls = 0;
  const execute = async () => ++calls;
  for (
    const input of [
      { status: "completed" },
      { status: "completed", output: undefined },
      { status: "completed", output: null, runId: "other" },
      { status: "failed" },
      { status: "failed", error: [] },
      { status: "failed", error: { code: "ERR", message: "bad" }, output: null },
      { status: "failed", error: { code: "lowercase", message: "bad" } },
      { status: "failed", error: { code: "ERR", message: "  " } },
      { status: "failed", error: { code: "ERR", message: "x".repeat(2001) } },
      { status: "failed", error: { code: "ERR", message: "bad", extra: true } },
      { status: "cancelled", output: null },
    ]
  ) {
    await assertRejects(() => executeTerminalRunTool("finalized", input, context, execute));
    assertEquals(control.signal.aborted, false);
  }
  assertEquals(calls, 0);
  assertEquals(await executeTerminalRunTool("ordinary", {}, context, execute), 1);
});

it("terminal execution requires a bound invocation while ordinary tools remain usable", async () => {
  const action = { status: "completed", output: null };
  for (
    const value of [undefined, {}, { runId: "run-current", runIdBindsToolAuthorization: false }]
  ) {
    const control = createTerminalRunControl(value);
    await assertRejects(() =>
      executeTerminalRunTool("finalized", action, control.context, async () => {
        throw new Error("must not dispatch");
      })
    );
    assertEquals(control.signal.aborted, false);
  }
  await assertRejects(() =>
    executeTerminalRunTool("finalized", action, undefined, async () => null)
  );
  assertEquals(await dispatchWithTerminalRunControl(undefined, async () => "ordinary"), "ordinary");
  await awaitTerminalRunControl();
});

it("schema rejection permits correction and sends only the validated output", async () => {
  const control = createTerminalRunControl({ runId: "run-current" }, undefined, async (output) => {
    if (typeof output !== "string") throw new Error("invalid output");
    return output.trim();
  });
  let dispatched = 0;
  await assertRejects(() =>
    executeTerminalRunTool(
      "finalized",
      { status: "completed", output: 42 },
      control.context,
      async () => ++dispatched,
    )
  );
  assertEquals(dispatched, 0);
  const input = { status: "completed", output: " done " };
  await assertRejects(() =>
    executeTerminalRunTool("finalized", input, control.context, async () => {
      dispatched++;
      assertEquals(input.output, "done");
      return { run: { run_id: "run-current", status: "completed", output: input.output } };
    })
  );
  assertEquals(dispatched, 1);
  assertEquals(terminalCompletionResponse(control.signal.reason)?.object, "done");
});

it("a rejected MCP action is recoverable, but an uncertain committed result stops dispatch", async () => {
  for (const outcome of ["recoverable", "lost-reply", "unavailable", "malformed"] as const) {
    const control = createTerminalRunControl({ runId: "run-current" });
    const input = { status: "failed", error: { code: "ERR", message: "failed" } };
    let calls = 0;
    const operation = () =>
      executeTerminalRunTool("finalized", input, control.context, async () => {
        calls++;
        if (outcome === "recoverable") return { isError: true };
        if (outcome === "unavailable" || (outcome === "lost-reply" && calls === 1)) {
          throw new TypeError("reply unavailable");
        }
        if (outcome === "malformed") return { run: { run_id: "other", status: "failed" } };
        return { run: { run_id: "run-current", status: "failed", error: input.error } };
      });
    if (outcome === "recoverable") {
      assertEquals(await operation(), { isError: true });
      assertEquals(
        await dispatchWithTerminalRunControl(control.context, async () => "retry"),
        "retry",
      );
      assertEquals(control.signal.aborted, false);
    } else {
      const error = await assertRejects(operation);
      assert(isTerminalRunControlError(error));
      assertEquals(error.code, outcome === "lost-reply" ? "ERR" : "RUN_OUTCOME_UNKNOWN");
      assertEquals(control.signal.reason, error);
      await assertRejects(() => awaitTerminalRunControl(control.context));
      await assertRejects(() =>
        dispatchWithTerminalRunControl(control.context, async () => "forbidden")
      );
    }
    assertEquals(calls, outcome === "lost-reply" || outcome === "unavailable" ? 2 : 1);
  }
});

it("terminal response preserves canonical output and recorded execution state", () => {
  for (const output of ["done", { count: 3 }, null]) {
    const error = new TerminalRunControlError(
      "RUN_TERMINAL",
      "Run is completed",
      "completed",
      output,
    );
    error.executionState = {
      messages: [{
        id: "message-1",
        role: "assistant",
        parts: [{ type: "text", text: "Effect recorded" }],
        timestamp: 1,
      }],
      toolCalls: [{
        id: "call-1",
        name: "write_record",
        args: {},
        status: "completed",
        result: "record-1",
      }],
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    };
    const response = terminalCompletionResponse(error, true)!;
    assertEquals(response.object, output);
    assertEquals(response.text, JSON.stringify(output));
    assertEquals(response.usage, error.executionState.usage);
    assertEquals(response.messages, error.executionState.messages);
    assertEquals(response.toolCalls, error.executionState.toolCalls);
    assertEquals(response.status, "completed");
  }
  assertEquals(
    terminalCompletionResponse(new TerminalRunControlError("ERR", "failed", "failed")),
    undefined,
  );
  assertEquals(terminalCompletionResponse(new Error("application")), undefined);
  assertEquals(isTerminalRunControlError({ name: "TerminalRunControlError" }), false);
  assertEquals(
    terminalCompletionResponse(new TerminalRunControlError("OK", "done", "completed", "done"))
      ?.text,
    "done",
  );
});
