import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { registerVeryfrontCloudModelFacts } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import type { AgentRunEvent, AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import { generateText, streamText } from "#veryfront/runtime/runtime-bridge.ts";
import { runWithMandatoryRunEventSink } from "#veryfront/runtime/run-event-sink-context.ts";
import {
  bindRuntimeObservationWriterCapability,
  createRuntimeObservationWriterCapability,
} from "#veryfront/runtime/runtime-observation-carrier.ts";

import { snapshotJsonValue, stringifyToolResultValue } from "#veryfront/provider/runtime-loader.ts";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

for (const cloud of [false, true]) {
  for (const streaming of [false, true]) {
    for (
      const mutation of [
        "input",
        "model",
        "callable",
        "function-schema",
        "provider-args",
        "date",
        "toJSON-data",
        "snapshot-array",
        "prepare-model",
        "url",
        "url-accessor",
      ] as const
    ) {
      if (mutation === "prepare-model" && !cloud) continue;
      it(`owns ${mutation} during ${cloud ? "Cloud" : "native"} ${streaming ? "stream" : "generate"} capture acknowledgement`, async () => {
        const image = {
          type: "image",
          mediaType: "image/png",
          url: "https://example.com/before.png",
        } satisfies { type: "image"; mediaType: string; url: string };
        const originalUrl = new URL("https://example.com/resource");
        let hrefGetterCalls = 0;
        if (mutation === "url-accessor") {
          Object.defineProperty(originalUrl, "href", {
            get() {
              hrefGetterCalls++;
              throw new Error("Caller URL href getter must not run");
            },
          });
        }
        const originalDate = new Date("2026-10-10T12:00:00.000Z");
        const value = {
          ...(mutation === "toJSON-data" ? { toJSON: "before" } : {}),
          nested: {
            answer: "before",
            ...(mutation === "date" ? { at: originalDate } : {}),
            ...(mutation === "url" || mutation === "url-accessor" ? { url: originalUrl } : {}),
          },
        };
        const toolValue = mutation === "snapshot-array"
          ? snapshotJsonValue({ items: [1, 2] })
          : value;
        const inputSchema = {
          type: "object",
          properties: {
            city: { type: "string", enum: ["Berlin"] },
            ...(mutation === "toJSON-data" ? { toJSON: { type: "string" } } : {}),
          },
          required: mutation === "toJSON-data" ? ["toJSON"] : ["city"],
          additionalProperties: false,
        };
        const providerArgs = {
          user_location: { type: "approximate", city: "Berlin" },
        };
        let dispatched: ModelRuntimeCallOptions | undefined;
        let dispatchOwner: string | undefined;
        let recorded: AgentRunEvent | undefined;
        function model(owner: string): ModelRuntime<ModelRuntimeCallOptions> {
          const runtime: ModelRuntime<ModelRuntimeCallOptions> = {
            provider: cloud ? "veryfront-cloud" : "openai",
            modelId: owner,
            specificationVersion: "v3",
            doGenerate(options) {
              dispatchOwner = owner;
              dispatched = options;
              assertEquals(this, runtime);
              return Promise.resolve({
                content: [{ type: "text", text: "ok" }],
                finishReason: "stop",
                usage: {},
              });
            },
            doStream(options) {
              dispatchOwner = owner;
              dispatched = options;
              assertEquals(this, runtime);
              return Promise.resolve({
                stream: new ReadableStream<unknown>({
                  start(controller) {
                    controller.enqueue({ type: "text-delta", delta: "ok" });
                    controller.enqueue({ type: "finish", finishReason: "stop", usage: {} });
                    controller.close();
                  },
                }),
              });
            },
          };
          if (cloud) {
            registerVeryfrontCloudModelFacts(
              runtime,
              () => ({
                provider: "openai",
                surface: "openai",
                native: true,
                transportPlan: { transport: "chat-completions", pinned: true },
              }),
            );
          }
          return runtime;
        }
        const original = model("original");
        const replacement = model("replacement");
        const options: Parameters<typeof generateText>[0] = {
          model: original,
          tools: {
            weather: { description: "Read weather", inputSchema: { jsonSchema: inputSchema } },
            search: { type: "provider", id: "openai.web_search", args: providerArgs },
          },
          messages: [
            { role: "user", content: [image] },
            {
              role: "tool",
              content: [{
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "noop",
                output: { type: "json", value: toolValue },
              }],
            },
          ],
        };
        if (mutation === "prepare-model") {
          original.prepare = async () => {
            await Promise.resolve();
            options.model = replacement;
          };
        }
        const sink: AgentRunEventSink = async (event) => {
          if (event.type !== "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED") return;
          recorded = event;
          await Promise.resolve();
          switch (mutation) {
            case "input":
              image.url = "https://example.com/after.png";
              value.nested.answer = "after";
              break;
            case "function-schema":
              inputSchema.properties.city.enum[0] = "Paris";
              inputSchema.required.push("region");
              break;
            case "provider-args":
              providerArgs.user_location.city = "Paris";
              break;
            case "snapshot-array":
            case "prepare-model":
              break;
            case "toJSON-data":
              value.toJSON = "after";
              assert(inputSchema.properties.toJSON);
              inputSchema.properties.toJSON.type = "number";
              break;
            case "url":
            case "url-accessor":
              originalUrl.pathname = "/mutated";
              break;
            case "date":
              originalDate.setTime(Date.parse("2026-10-11T12:00:00.000Z"));
              break;
            case "model":
              options.model = replacement;
              break;
            case "callable":
              original.doGenerate = replacement.doGenerate;
              original.doStream = replacement.doStream;
              break;
          }
          if (cloud) {
            assert(event.modelCallId);
            return {
              eventId: "9007199254740993",
              projectId,
              runId,
              modelCallId: event.modelCallId,
            };
          }
        };
        if (cloud) {
          bindRuntimeObservationWriterCapability(
            sink,
            createRuntimeObservationWriterCapability({
              scope: { runId, canonicalRunId: runId, projectId },
            }),
          );
        }
        await runWithMandatoryRunEventSink(sink, async () => {
          if (streaming) {
            for await (
              const _part of streamText(options).fullStream
            ) { /* Drain the actual dispatch. */ }
          } else await generateText(options);
        });
        assert(recorded?.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED");
        assert(dispatched);
        assertEquals(recorded.model?.id, "original");
        assertEquals(dispatchOwner, "original");
        if (mutation === "url" || mutation === "url-accessor") {
          const recordedTool = recorded.messages?.[1];
          assert(recordedTool?.role === "tool");
          const capturedValue = recordedTool.content[0]?.output.value;
          assert(
            typeof capturedValue === "object" && capturedValue !== null &&
              "nested" in capturedValue,
          );
          const capturedNested = capturedValue.nested;
          assert(
            typeof capturedNested === "object" && capturedNested !== null &&
              "url" in capturedNested,
          );
          assertEquals(capturedNested.url, "https://example.com/resource");
          assertEquals(JSON.stringify(recorded.messages), JSON.stringify(dispatched.prompt));
        } else assertEquals(dispatched.prompt, recorded.messages);
        assertEquals(dispatched.tools, recorded.tools);
        assertEquals(dispatched.tools, [
          {
            type: "function",
            name: "weather",
            description: "Read weather",
            inputSchema: {
              type: "object",
              properties: {
                city: { type: "string", enum: ["Berlin"] },
                ...(mutation === "toJSON-data" ? { toJSON: { type: "string" } } : {}),
              },
              required: mutation === "toJSON-data" ? ["toJSON"] : ["city"],
              additionalProperties: false,
            },
          },
          {
            type: "provider",
            name: "search",
            id: "openai.web_search",
            args: {
              user_location: { type: "approximate", city: "Berlin" },
            },
          },
        ]);
        assertEquals(dispatched.prompt[0], {
          role: "user",
          content: [{
            type: "image",
            mediaType: "image/png",
            url: "https://example.com/before.png",
          }],
        });
        if (mutation === "snapshot-array") {
          const toolMessage = dispatched.prompt[1];
          assert(toolMessage?.role === "tool");
          const result = toolMessage.content[0];
          assert(result?.type === "tool-result");
          assertEquals(stringifyToolResultValue(result.output.value), '{"items":[1,2]}');
        }
        if (mutation === "url" || mutation === "url-accessor") {
          const message = dispatched.prompt[1];
          assert(message?.role === "tool");
          const payload = message.content[0]?.output.value;
          assert(typeof payload === "object" && payload !== null && "nested" in payload);
          const nested = payload.nested;
          assert(typeof nested === "object" && nested !== null && "url" in nested);
          assert(nested.url instanceof URL);
          assert(nested.url !== originalUrl);
          assertEquals(nested.url.href, "https://example.com/resource");
          assert(
            JSON.stringify(dispatched.prompt).includes('"url":"https://example.com/resource"'),
          );
          assertEquals(hrefGetterCalls, 0);
        }
        assertEquals(dispatched.prompt[1], {
          role: "tool",
          content: [{
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "noop",
            output: {
              type: "json",
              value: mutation === "snapshot-array" ? { items: [1, 2] } : {
                ...(mutation === "toJSON-data" ? { toJSON: "before" } : {}),
                nested: {
                  answer: "before",
                  ...(mutation === "date" ? { at: new Date("2026-10-10T12:00:00.000Z") } : {}),
                  ...(mutation === "url" || mutation === "url-accessor"
                    ? { url: new URL("https://example.com/resource") }
                    : {}),
                },
              },
            },
          }],
        });
      });
    }
  }
}

for (const cloud of [false, true]) {
  for (const streaming of [false, true]) {
    for (
      const location of [
        "tool-result",
        "input",
        "counterfeit-array",
        "callable-toJSON",
        "Map",
        "Set",
        "typed-array",
        "RegExp",
        "custom-class",
      ] as const
    ) {
      it(`refuses ${location === "counterfeit-array" ? "counterfeit array guards" : location === "callable-toJSON" ? "callable toJSON payloads" : location === "tool-result" || location === "input" ? `${location} proxies before traps` : `${location} payloads`} in ${cloud ? "Cloud" : "native"} ${streaming ? "stream" : "generate"}`, async () => {
        let traps = 0;
        let captures = 0;
        let dispatches = 0;
        let hookCalls = 0;
        const proxy = new Proxy({ answer: "before" }, {
          ownKeys(target) {
            traps++;
            return Reflect.ownKeys(target);
          },
          getOwnPropertyDescriptor(target, key) {
            traps++;
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        });
        const counterfeit = [1, 2];
        Object.defineProperty(counterfeit, "toJSON", {
          value: undefined,
          enumerable: false,
          writable: false,
          configurable: false,
        });
        const guardedValue = { items: counterfeit };
        const callableValue = {
          answer: "before",
          toJSON() {
            hookCalls++;
            return { answer: "laundered" };
          },
        };
        if (location === "callable-toJSON") {
          assertThrows(() => stringifyToolResultValue(callableValue), TypeError);
          assertEquals(hookCalls, 0);
        }
        if (location === "counterfeit-array") {
          assertThrows(() => stringifyToolResultValue(guardedValue), TypeError);
        }
        class CustomPayload {
          answer = "before";
        }
        let unsupported: unknown;
        switch (location) {
          case "Map":
            unsupported = new Map([["answer", "before"]]);
            break;
          case "Set":
            unsupported = new Set(["before"]);
            break;
          case "typed-array":
            unsupported = new Uint8Array([1, 2]);
            break;
          case "RegExp":
            unsupported = /before/;
            break;
          case "custom-class":
            unsupported = new CustomPayload();
            break;
        }
        const unsupportedValue = { nested: unsupported };
        if (unsupported !== undefined) {
          assertThrows(() => stringifyToolResultValue(unsupportedValue), TypeError);
        }
        const model: ModelRuntime<ModelRuntimeCallOptions> = {
          provider: cloud ? "veryfront-cloud" : "openai",
          modelId: "proxy-model",
          specificationVersion: "v3",
          doGenerate() {
            dispatches++;
            return Promise.reject(new Error("Unexpected dispatch"));
          },
          doStream() {
            dispatches++;
            return Promise.reject(new Error("Unexpected dispatch"));
          },
        };
        if (cloud) {
          registerVeryfrontCloudModelFacts(
            model,
            () => ({
              provider: "openai",
              surface: "openai",
              native: true,
              transportPlan: { transport: "chat-completions", pinned: true },
            }),
          );
        }
        const sink: AgentRunEventSink = (event) => {
          if (event.type !== "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED") return;
          captures++;
          if (cloud) {
            assert(event.modelCallId);
            return {
              eventId: "9007199254740993",
              projectId,
              runId,
              modelCallId: event.modelCallId,
            };
          }
        };
        if (cloud) {
          bindRuntimeObservationWriterCapability(
            sink,
            createRuntimeObservationWriterCapability({
              scope: { runId, canonicalRunId: runId, projectId },
            }),
          );
        }
        const options: Parameters<typeof generateText>[0] = {
          model,
          messages: location !== "input"
            ? [{
              role: "tool",
              content: [{
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "noop",
                output: {
                  type: "json",
                  value: location === "counterfeit-array"
                    ? guardedValue
                    : location === "callable-toJSON"
                    ? callableValue
                    : unsupported !== undefined
                    ? unsupportedValue
                    : proxy,
                },
              }],
            }]
            : [{
              role: "assistant",
              content: [{
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "noop",
                input: proxy,
              }],
            }, { role: "user", content: "Continue" }],
        };
        await assertRejects(() =>
          runWithMandatoryRunEventSink(sink, async () => {
            if (streaming) {
              for await (const _part of streamText(options).fullStream) { /* Drain rejection. */ }
            } else await generateText(options);
          })
        );
        assertEquals({ traps, captures, dispatches, hookCalls }, {
          traps: 0,
          captures: 0,
          dispatches: 0,
          hookCalls: 0,
        });
      });
    }
  }
}

for (const cloud of [false, true]) {
  for (const streaming of [false, true]) {
    for (
      const leaf of [
        "tool-result",
        "tool-input",
        "function-schema",
        "provider-args",
        "large-array",
        "overdepth",
      ] as const
    ) {
      it(`preserves ${leaf} semantic JSON budget in ${cloud ? "Cloud" : "native"} ${streaming ? "stream" : "generate"}`, async () => {
        let payload: Record<string, unknown> | number[] = { input: "value" };
        for (let depth = 0; depth < (leaf === "overdepth" ? 64 : 60); depth++) {
          payload = { input: payload };
        }
        if (leaf === "large-array") payload = Array.from({ length: 65_535 }, () => 1);
        const serialized = leaf === "overdepth" ? undefined : stringifyToolResultValue(payload);
        if (leaf === "overdepth") assertThrows(() => stringifyToolResultValue(payload), TypeError);
        let captures = 0;
        let dispatches = 0;
        let dispatched: ModelRuntimeCallOptions | undefined;
        const model: ModelRuntime<ModelRuntimeCallOptions> = {
          provider: cloud ? "veryfront-cloud" : "openai",
          modelId: "budget-model",
          specificationVersion: "v3",
          doGenerate(options) {
            dispatches++;
            dispatched = options;
            return Promise.resolve({
              content: [{ type: "text", text: "ok" }],
              finishReason: "stop",
              usage: {},
            });
          },
          doStream(options) {
            dispatches++;
            dispatched = options;
            return Promise.resolve({
              stream: new ReadableStream<unknown>({
                start(controller) {
                  controller.enqueue({ type: "finish", finishReason: "stop", usage: {} });
                  controller.close();
                },
              }),
            });
          },
        };
        if (cloud) {
          registerVeryfrontCloudModelFacts(
            model,
            () => ({
              provider: "openai",
              surface: "openai",
              native: true,
              transportPlan: { transport: "chat-completions", pinned: true },
            }),
          );
        }
        const sink: AgentRunEventSink = (event) => {
          if (event.type !== "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED") return;
          captures++;
          if (cloud) {
            assert(event.modelCallId);
            return {
              eventId: "9007199254740993",
              projectId,
              runId,
              modelCallId: event.modelCallId,
            };
          }
        };
        if (cloud) {
          bindRuntimeObservationWriterCapability(
            sink,
            createRuntimeObservationWriterCapability({
              scope: { runId, canonicalRunId: runId, projectId },
            }),
          );
        }
        const options: Parameters<typeof generateText>[0] = {
          model,
          messages: leaf === "tool-input"
            ? [{
              role: "assistant",
              content: [{
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "noop",
                input: Array.isArray(payload) ? {} : payload,
              }],
            }, { role: "user", content: "Continue" }]
            : leaf === "function-schema" || leaf === "provider-args"
            ? [{ role: "user", content: "Continue" }]
            : [{
              role: "tool",
              content: [{
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "noop",
                output: { type: "json", value: payload },
              }],
            }],
          ...(leaf === "function-schema"
            ? { tools: { noop: { inputSchema: { jsonSchema: payload } } } }
            : leaf === "provider-args"
            ? { tools: { search: { type: "provider", id: "openai.web_search", args: payload } } }
            : {}),
        };
        const invoke = () =>
          runWithMandatoryRunEventSink(sink, async () => {
            if (streaming) {
              for await (const _part of streamText(options).fullStream) { /* Drain dispatch. */ }
            } else await generateText(options);
          });
        if (leaf === "overdepth") {
          await assertRejects(invoke);
          assertEquals({ captures, dispatches }, { captures: 0, dispatches: 0 });
          return;
        }
        await invoke();
        assert(dispatched);
        assertEquals({ captures, dispatches }, { captures: 1, dispatches: 1 });
        let sent: unknown;
        if (leaf === "function-schema" || leaf === "provider-args") {
          const definition = dispatched.tools?.[0];
          assert(definition);
          sent = definition.type === "function" ? definition.inputSchema : definition.args;
        } else {
          const message = dispatched.prompt[0];
          assert(message);
          if (message.role === "tool") sent = message.content[0]?.output.value;
          else {
            assert(message.role === "assistant");
            const part = message.content[0];
            assert(part?.type === "tool-call");
            sent = part.input;
          }
        }
        assertEquals(stringifyToolResultValue(sent), serialized);
      });
    }
  }
}
