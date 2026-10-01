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
