import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent } from "#veryfront/agent/factory.ts";
import { createExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import { createExecutorDiscovery } from "#veryfront/agent/hosted/executor-discovery.ts";
import { createExecutorRuntimePreparation } from "#veryfront/agent/hosted/executor-runtime-prepare.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";

describe("prepared executor private iteration", () => {
  for (
    const probe of [
      "async generators",
      "inherited metadata",
      "array iteration",
      "array append",
      "text extraction",
      "promise chaining",
    ]
  ) {
    it(`keeps stream requests and model output out of replaced ${probe}`, async () => {
      const binding = { allocationId: "iterators", invocationId: "iterators", generation: 1 };
      const source = { type: "release", releaseId: "synthetic-release" } as const;
      const modelId = "veryfront-cloud/openai/gpt-5.4";
      const coder = agent({
        id: "coder",
        system: "Synthetic source instructions.",
        model: modelId,
        maxSteps: 3,
        tools: {},
      });
      let facadeCleanups = 0;
      let discoveryCleanups = 0;
      const marker = "synthetic-private-iterator-marker";
      const model = scriptedModel([{ text: marker }]);
      const discovery = createExecutorDiscovery({
        binding,
        source,
        projectDir: "/synthetic-project",
        signal: new AbortController().signal,
        backend: {
          load: () =>
            Promise.resolve({
              agents: new Map([[coder.id, coder]]),
              tools: new Map(),
              skills: new Map(),
              prompts: new Map(),
              resources: new Map(),
              workflows: new Map(),
              tasks: new Map(),
              schedules: new Map(),
              webhooks: new Map(),
              evals: new Map(),
              errors: [],
              sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
            }),
          cleanup: () => {
            discoveryCleanups++;
            return Promise.resolve();
          },
        },
      });
      const owner = createExecutorRuntimePreparation({
        binding,
        source,
        discovery,
        grant: {
          agentId: "coder",
          defaultModelId: modelId,
          maxSteps: 5,
          models: new Map([[modelId, { maxOutputTokens: 200, providerToolNames: [] }]]),
          allowedToolNames: [],
          hostToolFacadeIds: [],
          remoteToolSourceIds: [],
          execution: { kind: "ephemeral", projectId: null },
        },
        facades: {
          hostTools: new Map(),
          remoteToolSources: new Map(),
          resolveModelRuntime: () => model,
          cleanup: () => {
            facadeCleanups++;
            return Promise.resolve();
          },
        },
      });
      const forward = new TransformStream<Uint8Array, Uint8Array>();
      const backward = new TransformStream<Uint8Array, Uint8Array>();
      const broker = createExecutorChannel({
        binding,
        transport: { readable: backward.readable, writable: forward.writable },
      });
      const executor = createExecutorChannel({
        binding,
        operations: owner.operations,
        transport: { readable: forward.readable, writable: backward.writable },
      });
      const prototype = Object.getPrototypeOf(Object.getPrototypeOf((async function* () {})()));
      const originalArrayIterator = Array.prototype[Symbol.iterator];
      const originalPush = Array.prototype.push;
      const originalFilter = Array.prototype.filter;
      const originalThen = Promise.prototype.then;
      const originalMetadata = Object.getOwnPropertyDescriptor(Object.prototype, "metadata");
      const originalNext = prototype.next;
      const originalReturn = prototype.return;
      let observations = 0;
      let frames: JsonValue[] = [];
      const observeMessages = (value: unknown) => {
        const messages = Array.isArray(value)
          ? value
          : value !== null && typeof value === "object"
          ? Object.getOwnPropertyDescriptor(value, "messages")?.value
          : undefined;
        if (!Array.isArray(messages)) return;
        for (let index = 0; index < messages.length; index++) {
          const parts = messages[index]?.parts;
          if (!Array.isArray(parts)) continue;
          for (let partIndex = 0; partIndex < parts.length; partIndex++) {
            if (parts[partIndex]?.text === marker) {
              observations++;
              return;
            }
          }
        }
      };
      const hook = (original: typeof originalNext) =>
        async function (this: unknown, ...args: unknown[]) {
          const result = await Reflect.apply(original, this, args) as IteratorResult<unknown>;
          if (JSON.stringify(result.value)?.includes(marker)) observations++;
          return result;
        };
      try {
        await Promise.all([broker.ready, executor.ready]);
        if (probe === "async generators") {
          prototype.next = hook(originalNext);
          prototype.return = hook(originalReturn);
        } else if (probe === "array iteration") {
          Array.prototype[Symbol.iterator] = (function (this: unknown[]) {
            observeMessages(this);
            return Reflect.apply(originalArrayIterator, this, []);
          }) as typeof originalArrayIterator;
        } else if (probe === "array append") {
          Array.prototype.push = function (...items) {
            observeMessages(this);
            return Reflect.apply(originalPush, this, items);
          };
        } else if (probe === "text extraction") {
          Array.prototype.filter = function (
            this: unknown[],
            callback: (value: unknown, index: number, array: unknown[]) => unknown,
            thisArg?: unknown,
          ) {
            for (let index = 0; index < this.length; index++) {
              const part = this[index] as { type?: unknown; text?: unknown } | null;
              if (part?.type === "text" && part?.text === marker) observations++;
            }
            return Reflect.apply(originalFilter, this, [callback, thisArg]);
          } as typeof originalFilter;
        } else if (probe === "promise chaining") {
          Promise.prototype.then = (function (
            this: Promise<unknown>,
            fulfilled: ((value: unknown) => unknown) | null | undefined,
            rejected: ((reason: unknown) => unknown) | null | undefined,
          ) {
            return Reflect.apply(originalThen, this, [(value: unknown) => {
              observeMessages(value);
              return typeof fulfilled === "function"
                ? Reflect.apply(fulfilled, undefined, [value])
                : value;
            }, rejected]);
          }) as typeof originalThen;
        } else {
          Object.defineProperty(Object.prototype, "metadata", {
            configurable: true,
            get() {
              const parts = Object.getOwnPropertyDescriptor(this, "parts")?.value;
              if (Array.isArray(parts) && parts.some((part) => part?.text === marker)) {
                observations++;
              }
              return undefined;
            },
          });
        }
        const prepared = await broker.request("runtime.prepare", { agentId: "coder" }) as {
          ok: boolean;
          value: { preparedRuntimeHandle: string };
        };
        assertEquals(prepared.ok, true);
        frames = await Array.fromAsync(broker.stream("agent.stream", {
          preparedRuntimeHandle: prepared.value.preparedRuntimeHandle,
          messages: [{
            id: "synthetic-message",
            role: "user",
            parts: [{ type: "text", text: marker }],
            timestamp: 1,
          }],
        }));
      } finally {
        Array.prototype[Symbol.iterator] = originalArrayIterator;
        Array.prototype.push = originalPush;
        Array.prototype.filter = originalFilter;
        Promise.prototype.then = originalThen;
        if (originalMetadata) Object.defineProperty(Object.prototype, "metadata", originalMetadata);
        else Reflect.deleteProperty(Object.prototype, "metadata");
        prototype.next = originalNext;
        prototype.return = originalReturn;
        broker.close();
        executor.close();
        await Promise.all([broker.settled, executor.settled]);
        await owner.close();
        await owner.settled;
      }
      assertEquals(frames[0], { type: "ready" });
      assertEquals(frames.at(-1), { type: "complete" });
      assertEquals(frames.some((frame) => JSON.stringify(frame).includes(marker)), true);
      assertEquals(observations, 0);
      assertEquals(facadeCleanups, 1);
      assertEquals(discoveryCleanups, 1);
    });
  }
});
