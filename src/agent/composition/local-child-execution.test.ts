import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  executeLocalChild,
  observeGeneratedAgentTurn,
  observeRuntimeStream,
  withLocalChildExecution,
  withLocalChildRuntime,
  withoutAutomaticRuntimeStreamObservation,
} from "./local-child-execution.ts";
import { createAgUiEncoderState, mapRuntimeStreamEventToAgUiEvents } from "../ag-ui/encoder.ts";
import { coerceWireEvent } from "../ag-ui/sse-parser.ts";

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
  const owner = new AgentRuntime("owner", { model: "test/model", system: "Owner" });
  const unrelated = new AgentRuntime("unrelated", { model: "test/model", system: "Unrelated" });
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

it("distinct top-level runtimes in one task scope are observed independently", async () => {
  const first = new AgentRuntime("first", { model: "test/model", system: "First" });
  const second = new AgentRuntime("second", { model: "test/model", system: "Second" });
  const observed: string[] = [];

  await withLocalChildExecution(async (input) => input.execute(), async () => {
    await withLocalChildRuntime(first, async () => {
      await observeGeneratedAgentTurn("first-message", { text: "one" });
    });
    await withLocalChildRuntime(second, async () => {
      await observeGeneratedAgentTurn("second-message", { text: "two" });
    });
  }, async (event) => {
    if (event.type === "text-delta") observed.push(String(event.delta));
  });

  assertEquals(observed, ["one", "two"]);
});

it("concurrent top-level runtimes each retain their observation scope", async () => {
  const first = new AgentRuntime("first", { model: "test/model", system: "First" });
  const second = new AgentRuntime("second", { model: "test/model", system: "Second" });
  const ready = Promise.withResolvers<void>();
  let entered = 0;
  const observed: string[] = [];
  const turn = (runtime: AgentRuntime, text: string) =>
    withLocalChildRuntime(runtime, async () => {
      if (++entered === 2) ready.resolve();
      await ready.promise;
      await observeGeneratedAgentTurn(text, { text });
    });
  await withLocalChildExecution(
    async (input) => input.execute(),
    () => Promise.all([turn(first, "one"), turn(second, "two")]),
    async (event) => {
      if (event.type === "text-delta") observed.push(String(event.delta));
    },
  );
  assertEquals(observed.sort(), ["one", "two"]);
});

it("observer factories isolate AG-UI encoder state across parallel top-level runtimes", async () => {
  const first = new AgentRuntime("first", { model: "test/model", system: "First" });
  const second = new AgentRuntime("second", { model: "test/model", system: "Second" });
  const ready = Promise.withResolvers<void>();
  let entered = 0;
  const encoded: Array<Record<string, unknown> & { factory: number; type: string }> = [];
  const turn = (runtime: AgentRuntime, messageId: string, text: string) =>
    withLocalChildRuntime(runtime, async () => {
      if (++entered === 2) ready.resolve();
      await ready.promise;
      await observeGeneratedAgentTurn(messageId, { text });
    });
  let factory = 0;

  await withLocalChildExecution(
    async (input) => input.execute(),
    () =>
      Promise.all([
        turn(first, "first-message", "one"),
        turn(second, "second-message", "two"),
      ]),
    undefined,
    undefined,
    () => {
      const factoryId = ++factory;
      const encoder = createAgUiEncoderState({ nowMs: null, epochMs: null });
      return async (event) => {
        for (const encodedEvent of mapRuntimeStreamEventToAgUiEvents(encoder, event)) {
          const wireEvent = coerceWireEvent(encodedEvent.event, encodedEvent.payload);
          if (typeof wireEvent.type !== "string") throw new Error("Invalid wire event");
          encoded.push({ factory: factoryId, type: wireEvent.type, ...wireEvent });
        }
      };
    },
  );

  assertEquals(factory, 2);
  for (const factoryId of [1, 2]) {
    const textEvents = encoded.filter((event) =>
      event.factory === factoryId && event.type.startsWith("TEXT_MESSAGE_")
    );
    const starts = textEvents.filter((event) => event.type === "TEXT_MESSAGE_START");
    const ends = textEvents.filter((event) => event.type === "TEXT_MESSAGE_END");
    assertEquals(starts.length, 1);
    assertEquals(ends.length, 1);
    assertEquals(ends[0]?.messageId, starts[0]?.messageId);
    assertEquals(ends[0]?.contentId, starts[0]?.contentId);
  }
});

it("observes consumed runtime stream events before delivering stream chunks", async () => {
  const runtime = new AgentRuntime("streamed", { model: "test/model", system: "Streamed" });
  const encoder = new TextEncoder();
  const observedText = Promise.withResolvers<void>();
  const allowDelivery = Promise.withResolvers<void>();
  let delivered = false;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"type":"message-start","messageId":"stream-message"}\n\n' +
            'data: {"type":"text-delta","id":"stream-text","delta":"streamed"}\n\n',
        ),
      );
      controller.close();
    },
  });

  const observed = await withLocalChildExecution(
    async (input) => input.execute(),
    async () => withLocalChildRuntime(runtime, () => observeRuntimeStream(source)),
    undefined,
    undefined,
    () => async (event) => {
      if (event.type === "text-delta") {
        observedText.resolve();
        await allowDelivery.promise;
      }
    },
  );
  const reader = observed.getReader();
  const read = reader.read().then((value) => {
    delivered = true;
    return value;
  });

  await observedText.promise;
  assertEquals(delivered, false);
  allowDelivery.resolve();
  const next = await read;
  assertEquals(next.done, false);
  assertEquals(delivered, true);
});

it("can suppress automatic stream observation when the consumer forwards events itself", async () => {
  const runtime = new AgentRuntime("forwarded", { model: "test/model", system: "Forwarded" });
  const encoder = new TextEncoder();
  let observed = 0;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"type":"text-delta","id":"forwarded-text","delta":"once"}\n\n'),
      );
      controller.close();
    },
  });

  const stream = await withLocalChildExecution(
    async (input) => input.execute(),
    async () =>
      withLocalChildRuntime(
        runtime,
        () => withoutAutomaticRuntimeStreamObservation(() => observeRuntimeStream(source)),
      ),
    undefined,
    undefined,
    () => async () => {
      observed++;
    },
  );
  await stream.getReader().read();

  assertEquals(observed, 0);
});

it("cancels the source runtime stream when observation fails", async () => {
  const runtime = new AgentRuntime("failing-observer", {
    model: "test/model",
    system: "Failing observer",
  });
  const encoder = new TextEncoder();
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"type":"text-delta","id":"failing-text","delta":"stop"}\n\n'),
      );
    },
    cancel() {
      cancelled = true;
    },
  });

  const stream = await withLocalChildExecution(
    async (input) => input.execute(),
    async () => withLocalChildRuntime(runtime, () => observeRuntimeStream(source)),
    undefined,
    undefined,
    () => async () => {
      throw new Error("observation failed");
    },
  );
  await stream.getReader().read().catch(() => undefined);

  assertEquals(cancelled, true);
});
