import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import type { ToolExecutionContext } from "#veryfront/tool/types.ts";
import {
  awaitTerminalRunControl,
  createTerminalRunControl,
  dispatchWithTerminalRunControl,
  executeTerminalRunTool,
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
