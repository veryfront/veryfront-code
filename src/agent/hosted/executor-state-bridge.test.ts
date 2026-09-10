import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createExecutorChannel, type ExecutorOperation } from "../executor/channel.ts";
import type { ExecutorRuntimeFacades } from "./executor-runtime-prepare.ts";
import { createExecutorStateBroker, createExecutorStateFacades } from "./executor-state-bridge.ts";
import { executorStateJson, executorStateOperations } from "./executor-state-schema.ts";

const binding = {
  allocationId: "allocation-state",
  generation: 3,
  invocationId: "invocation-state",
};
const scope = { agentId: "coder", projectId: "project-1", branchId: "branch-1" };
const capabilityIds = {
  projectSteering: "steering-capability",
  conversationUserText: "text-capability",
};
const definition = { id: "coder", name: "Coder", description: "Codes", instructions: "Work" };
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function pair(operations: ReadonlyMap<string, ExecutorOperation>) {
  const forward = new TransformStream<Uint8Array, Uint8Array>();
  const backward = new TransformStream<Uint8Array, Uint8Array>();
  const executor = createExecutorChannel({
    binding,
    transport: { readable: backward.readable, writable: forward.writable },
  });
  const broker = createExecutorChannel({
    binding,
    transport: { readable: forward.readable, writable: backward.writable },
    operations,
  });
  return {
    executor,
    broker,
    async close() {
      executor.close();
      await broker.closed;
      await Promise.all([executor.settled, broker.settled]);
    },
  };
}

describe("executor state bridge", () => {
  it("forwards a narrowed tool selection and rejects names outside the installed grant", async () => {
    const seen: unknown[] = [];
    const channels = pair(createExecutorStateBroker({
      expectedBinding: binding,
      ...scope,
      capabilityIds: { projectSteering: capabilityIds.projectSteering },
      allowedToolNames: ["read_file", "load_skill"],
      prepareProjectSteering: async (input) => ({ agent: input.definition }),
      refreshProjectSteering: async (_signal, availableToolNames) => {
        seen.push(availableToolNames);
        return "refresh";
      },
    }));
    try {
      const facades = createExecutorStateFacades({
        channel: channels.executor,
        ...scope,
        capabilityIds: { projectSteering: capabilityIds.projectSteering },
      });
      const signal = new AbortController().signal;
      await facades.projectSteering!.refresh(signal, ["read_file"]);
      await facades.projectSteering!.refresh(signal, ["load_skill"]);
      await facades.projectSteering!.refresh(signal);
      await assertRejects(() => facades.projectSteering!.refresh(signal, ["write_file"]));
      assertEquals(seen, [["read_file"], ["load_skill"], []]);
    } finally {
      await channels.close();
    }
  });

  it("uses broker-owned scope and returns bounded steering and conversation state", async () => {
    const seen: unknown[] = [];
    const channels = pair(createExecutorStateBroker({
      expectedBinding: binding,
      ...scope,
      capabilityIds,
      prepareProjectSteering: async (input) => {
        seen.push({
          kind: "prepare",
          agentId: input.definition.id,
          projectId: input.projectId,
          branchId: input.branchId,
        });
        return {
          agent: input.definition,
          initialProjectInstructions: "Project instructions",
          initialSkills: [],
        };
      },
      refreshProjectSteering: async () => {
        seen.push({ kind: "refresh" });
        return "Refreshed instructions";
      },
      latestConversationUserText: async () => {
        seen.push({ kind: "text" });
        return "Latest user text";
      },
    }));
    try {
      const facades = createExecutorStateFacades({
        channel: channels.executor,
        ...scope,
        capabilityIds,
      });
      const compatible: Pick<
        ExecutorRuntimeFacades,
        "projectSteering" | "latestConversationUserText"
      > = facades;
      assertEquals(compatible, facades);
      assertEquals(
        await facades.projectSteering?.prepare({
          ...scope,
          definition,
          signal: new AbortController().signal,
        }),
        {
          agent: definition,
          initialProjectInstructions: "Project instructions",
          initialSkills: [],
        },
      );
      assertEquals(
        await facades.projectSteering?.refresh(new AbortController().signal),
        "Refreshed instructions",
      );
      assertEquals(
        await facades.latestConversationUserText?.(new AbortController().signal),
        "Latest user text",
      );
      assertEquals(seen, [
        { kind: "prepare", agentId: "coder", projectId: "project-1", branchId: "branch-1" },
        { kind: "refresh" },
        { kind: "text" },
      ]);
    } finally {
      await channels.close();
    }
  });

  it("rejects executor scope changes before channel dispatch", async () => {
    let calls = 0;
    const channels = pair(createExecutorStateBroker({
      expectedBinding: binding,
      ...scope,
      capabilityIds: { projectSteering: capabilityIds.projectSteering },
      prepareProjectSteering: async (input) => ({ agent: input.definition }),
      refreshProjectSteering: async () => {
        calls++;
        return "refresh";
      },
    }));
    try {
      const facades = createExecutorStateFacades({
        channel: channels.executor,
        ...scope,
        capabilityIds: { projectSteering: capabilityIds.projectSteering },
      });
      await assertRejects(() =>
        facades.projectSteering!.prepare({
          definition,
          projectId: "project-2",
          branchId: "branch-1",
          signal: new AbortController().signal,
        })
      );
      await assertRejects(() =>
        facades.projectSteering!.prepare({
          definition: { ...definition, id: "other" },
          projectId: "project-1",
          branchId: "branch-1",
          signal: new AbortController().signal,
        })
      );
      assertEquals(calls, 0);
    } finally {
      await channels.close();
    }
  });

  it("binds broker handlers and rejects wire authority fields", async () => {
    let calls = 0;
    const operations = createExecutorStateBroker({
      expectedBinding: binding,
      ...scope,
      capabilityIds: { conversationUserText: capabilityIds.conversationUserText },
      latestConversationUserText: async () => {
        calls++;
        return null;
      },
    });
    const operation = operations.get(executorStateOperations.latestConversationUserText);
    if (operation?.mode !== "unary") throw new Error("missing operation");
    for (
      const value of [
        { capabilityId: capabilityIds.conversationUserText, authToken: "secret" },
        { capabilityId: capabilityIds.conversationUserText, projectId: "project-2" },
      ]
    ) {
      await assertRejects(() =>
        Promise.resolve(
          operation.handle(executorStateJson(value), {
            binding,
            signal: new AbortController().signal,
            deadline: Date.now() + 1_000,
          }),
        )
      );
    }
    await assertRejects(() =>
      Promise.resolve(
        operation.handle({ capabilityId: capabilityIds.conversationUserText }, {
          binding: { ...binding, generation: 4 },
          signal: new AbortController().signal,
          deadline: Date.now() + 1_000,
        }),
      )
    );
    assertEquals(calls, 0);
  });

  it("fails closed on incomplete capability handlers", () => {
    assertThrows(() =>
      createExecutorStateBroker({
        expectedBinding: binding,
        ...scope,
        capabilityIds: { projectSteering: capabilityIds.projectSteering },
      })
    );
  });

  it("forwards refresh cancellation and retains a noncooperative read through channel settlement", async () => {
    const entered = Promise.withResolvers<AbortSignal>();
    const release = Promise.withResolvers<void>();
    const channels = pair(createExecutorStateBroker({
      expectedBinding: binding,
      ...scope,
      capabilityIds: { projectSteering: capabilityIds.projectSteering },
      prepareProjectSteering: async (input) => ({ agent: input.definition }),
      refreshProjectSteering: async (signal) => {
        entered.resolve(signal);
        await release.promise;
        return "late refresh";
      },
    }));
    const owner = new AbortController();
    const call = new AbortController();
    const facades = createExecutorStateFacades({
      channel: channels.executor,
      ...scope,
      capabilityIds: { projectSteering: capabilityIds.projectSteering },
      signal: owner.signal,
    });
    const pending = facades.projectSteering!.refresh(call.signal);
    const observed = await entered.promise;
    call.abort();
    await tick();
    assertEquals(observed.aborted, true);

    channels.executor.close();
    await channels.broker.closed;
    await assertRejects(() => pending);
    let settled = false;
    void channels.broker.settled.then(() => settled = true);
    await tick();
    assertEquals(settled, false);
    release.resolve();
    await Promise.all([channels.executor.settled, channels.broker.settled]);
    assertEquals(settled, true);
  });

  it("rejects provider transport authority in refreshed system data", async () => {
    const channels = pair(createExecutorStateBroker({
      expectedBinding: binding,
      ...scope,
      capabilityIds: { projectSteering: capabilityIds.projectSteering },
      prepareProjectSteering: async (input) => ({ agent: input.definition }),
      refreshProjectSteering: async () => [{
        role: "system",
        content: "Synthetic",
        providerOptions: { headers: { authorization: "secret" } },
      }],
    }));
    try {
      const facades = createExecutorStateFacades({
        channel: channels.executor,
        ...scope,
        capabilityIds: { projectSteering: capabilityIds.projectSteering },
      });
      await assertRejects(() => facades.projectSteering!.refresh(new AbortController().signal));
    } finally {
      await channels.close();
    }
  });
});
