import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  executeLocalChild,
  observeGeneratedAgentTurn,
  withLocalChildExecution,
  withLocalChildRuntime,
} from "./local-child-execution.ts";

it("local child host scopes remain isolated across concurrent executions and close afterwards", async () => {
  let release!: () => void;
  const together = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = 0;
  const seen: string[] = [];
  const operation = (parent: string) =>
    withLocalChildExecution(async (input) => {
      seen.push(`${parent}:${input.context?.toolCallId}:${input.agentId}`);
      return await input.execute();
    }, async () => {
      if (++entered === 2) release();
      await together;
      return await executeLocalChild({
        agentId: `child-${parent}`,
        toolName: "invoke_agent",
        toolInput: {},
        input: parent,
        context: { toolCallId: `call-${parent}` },
        execute: () => Promise.resolve({ text: parent, status: "completed", toolCalls: 0 }),
      });
    });
  const values = await Promise.all([operation("parent-a"), operation("parent-b")]);
  assertEquals(values.map((value) => value.text), ["parent-a", "parent-b"]);
  assertEquals(seen.sort(), [
    "parent-a:call-parent-a:child-parent-a",
    "parent-b:call-parent-b:child-parent-b",
  ]);
  await executeLocalChild({
    agentId: "outside",
    toolName: "invoke_agent",
    toolInput: {},
    input: "outside",
    execute: () => Promise.resolve({ text: "outside", status: "completed", toolCalls: 0 }),
  });
  assertEquals(seen.length, 2);
});

it("unrelated nested runtimes cannot observe or delegate through another agent's child scope", async () => {
  const owner = {};
  const unrelated = {};
  const seen: string[] = [];
  const observed: string[] = [];
  const invoke = (id: string) =>
    executeLocalChild({
      agentId: id,
      toolName: "invoke_agent",
      toolInput: {},
      input: id,
      execute: () => Promise.resolve({ text: id, status: "completed", toolCalls: 0 }),
    });
  await withLocalChildExecution(async (input) => {
    seen.push(input.agentId);
    return input.execute();
  }, () =>
    withLocalChildRuntime(owner, async () => {
      await observeGeneratedAgentTurn("outer", { text: "visible" });
      await invoke("owned-before");
      await withLocalChildRuntime(unrelated, async () => {
        await observeGeneratedAgentTurn("inner", { text: "private" });
        await invoke("unrelated-local");
      });
      await invoke("owned-after");
    }), async (event) => {
    if (event.type === "text-delta") observed.push(String(event.delta));
  });
  assertEquals(observed, ["visible"]);
  assertEquals(seen, ["owned-before", "owned-after"]);
});
