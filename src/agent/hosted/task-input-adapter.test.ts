import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createHostedChatRuntimeAgentAdapter } from "./chat-runtime-agent-adapter.ts";
import type { HostedChatRuntimeAgentAdapterInput } from "./chat-runtime-agent-adapter.ts";
const scope = { projectId: "p", rootRunId: "root", runId: "child" };
const binding = () => ({ version: 1 as const, ...scope, payload: { intakeId: "intake" } });
function setup(taskInput: unknown) {
  let captured: Record<string, unknown> | undefined;
  let calls = 0;
  const adapter = createHostedChatRuntimeAgentAdapter({
    ...scope,
    taskInput,
    authToken: "host-token",
    sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    runtimeAgent: {
      stream(input) {
        calls++;
        captured = input.context;
        return Promise.resolve({
          toDataStreamResponse: () =>
            new Response(
              new ReadableStream({
                start(c) {
                  c.close();
                },
              }),
            ),
        });
      },
    },
  } as HostedChatRuntimeAgentAdapterInput);
  return { adapter, context: () => captured, calls: () => calls };
}
describe("hosted task input adapter", () => {
  it("snapshots host input before caller mutation and ignores stream context injection", async () => {
    const original = binding();
    const test = setup(original);
    original.payload.intakeId = "mutated";
    await test.adapter.stream(
      {
        messages: [],
        abortSignal: new AbortController().signal,
        context: {
          taskInput: { payload: { intakeId: "attacker" } },
          authToken: "attacker",
          projectId: "attacker",
        },
      } as Parameters<typeof test.adapter.stream>[0],
    );
    assertEquals(test.context()?.taskInput, binding());
    assertEquals(test.context()?.projectId, "p");
    // Current hosted adapter keeps credentials outside application tool context.
    assertEquals(test.context()?.authToken, undefined);
    assertEquals(Object.isFrozen(test.context()?.taskInput), true);
  });
  it("rejects mismatched execution authority before dispatch", () => {
    assertThrows(() => setup({ ...binding(), runId: "other" }));
  });
  it("does not synthesize absent input", async () => {
    const test = setup(undefined);
    await test.adapter.stream({ messages: [], abortSignal: new AbortController().signal });
    assertEquals(test.context()?.taskInput, undefined);
  });
});
