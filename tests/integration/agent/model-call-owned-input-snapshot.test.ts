import { buildModelCallContextRequest } from "#veryfront/runtime/model-call-context-request.ts";
import { buildOpenAIChatRequest } from "../../../extensions/ext-llm-openai/src/openai-chat-request-builder.ts";
import { buildAnthropicMessagesRequest } from "../../../extensions/ext-llm-anthropic/src/anthropic-request-builder.ts";
import { buildGoogleGenerateContentRequest } from "../../../extensions/ext-llm-google/src/google-request-builder.ts";
import { DurableRunEventPersistenceError } from "#veryfront/agent/conversation/private-run-event.ts";
import { buildOpenAIResponsesRequest } from "../../../extensions/ext-llm-openai/src/openai-responses-request-builder.ts";
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
        "boxed-BigInt",
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
          case "boxed-BigInt": {
            const boxed: object = Object(12n);
            for (const key of ["valueOf", "toJSON"]) {
              Object.defineProperty(boxed, key, {
                get() {
                  hookCalls++;
                  throw new Error("Caller BigInt hooks must not run");
                },
              });
            }
            unsupported = boxed;
            break;
          }
        }
        const unsupportedValue = { nested: unsupported };
        if (unsupported !== undefined) {
          assertThrows(() => stringifyToolResultValue(unsupportedValue), TypeError);
        }
        const model: ModelRuntime<ModelRuntimeCallOptions> = {
          provider: cloud ? "veryfront-cloud" : "openai",
          modelId: "proxy-model",
          ...(cloud ? { modelProvider: "openai" } : {}),
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
          if (cloud && location !== "boxed-BigInt") {
            assert(event.modelCallId);
            return {
              eventId: "9007199254740993",
              projectId,
              runId,
              modelCallId: event.modelCallId,
            };
          }
        };
        if (cloud && location !== "boxed-BigInt") {
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
        if (location === "boxed-BigInt") {
          options.messages = [{ role: "user", content: "Hello" }];
          options.providerOptions = { openai: { metadata: { value: unsupported } } };
        }
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

for (const cloud of [false, true]) {
  for (const streaming of [false, true]) {
    for (const scalar of ["Date", "URL"] as const) {
      it(`owns provider metadata ${scalar} in ${cloud ? "Cloud" : "native"} ${streaming ? "stream" : "generate"}`, async () => {
        const date = new Date("2026-10-10T12:00:00.000Z");
        const url = new URL("https://example.com/resource");
        let getterCalls = 0;
        Object.defineProperty(url, "href", {
          get() {
            getterCalls++;
            throw new Error("Caller href getter must not run");
          },
        });
        Object.defineProperty(date, "getTime", {
          get() {
            getterCalls++;
            throw new Error("Caller date getter must not run");
          },
        });
        const metadata = { requested_at: scalar === "Date" ? date : url };
        let dispatched: ModelRuntimeCallOptions | undefined;
        const model: ModelRuntime<ModelRuntimeCallOptions> = {
          provider: cloud ? "veryfront-cloud" : "openai",
          modelId: "gpt-4.1-mini",
          ...(cloud ? { modelProvider: "openai" } : {}),
          specificationVersion: "v3",
          doGenerate(options) {
            dispatched = options;
            return Promise.resolve({
              content: [{ type: "text", text: "ok" }],
              finishReason: "stop",
              usage: {},
            });
          },
          doStream(options) {
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
              transportPlan: { transport: "responses", pinned: true },
            }),
          );
        }
        let captures = 0;
        const sink: AgentRunEventSink = async (event) => {
          if (event.type !== "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED") return;
          captures++;
          await Promise.resolve();
          date.setTime(Date.parse("2026-10-11T12:00:00.000Z"));
          url.pathname = "/mutated";
        };
        const options: Parameters<typeof generateText>[0] = {
          model,
          messages: [{ role: "user", content: "Hello" }],
          providerOptions: { openai: { metadata } },
        };
        await runWithMandatoryRunEventSink(sink, async () => {
          if (streaming) {
            for await (const _part of streamText(options).fullStream) {
              /* Drain dispatch. */
            }
          } else await generateText(options);
        });
        assert(dispatched);
        assertEquals(captures, 1);
        const bucket = dispatched.providerOptions?.openai;
        assert(typeof bucket === "object" && bucket !== null && "metadata" in bucket);
        const ownedMetadata = bucket.metadata;
        assert(
          typeof ownedMetadata === "object" && ownedMetadata !== null &&
            "requested_at" in ownedMetadata,
        );
        const owned = ownedMetadata.requested_at;
        if (scalar === "Date") {
          if (owned instanceof Date) {
            assert(owned !== date);
            assertEquals(owned.toISOString(), "2026-10-10T12:00:00.000Z");
          } else assertEquals(owned, "2026-10-10T12:00:00.000Z");
        } else {
          if (owned instanceof URL) {
            assert(owned !== url);
            assertEquals(owned.href, "https://example.com/resource");
          } else assertEquals(owned, "https://example.com/resource");
        }
        const request = buildOpenAIResponsesRequest(
          "gpt-4.1-mini",
          "openai",
          dispatched,
          streaming,
          {
            push() {},
            drain() {
              return [];
            },
          },
        );
        assertEquals(
          JSON.stringify(request.metadata),
          JSON.stringify({
            requested_at: scalar === "Date"
              ? "2026-10-10T12:00:00.000Z"
              : "https://example.com/resource",
          }),
        );
        assertEquals(getterCalls, 0);
        if (owned instanceof Date) {
          owned.setTime(0);
          assertEquals(Date.prototype.getTime.call(date), Date.parse("2026-10-11T12:00:00.000Z"));
        } else if (owned instanceof URL) {
          owned.pathname = "/owned-only";
          assertEquals(url.pathname, "/mutated");
        }
      });
    }
  }
}

for (const cloud of [false, true]) {
  for (const streaming of [false, true]) {
    for (const scalar of ["String", "Number", "Boolean"] as const) {
      it(`preserves boxed ${scalar} provider wire values in ${cloud ? "Cloud" : "native"} ${streaming ? "stream" : "generate"}`, async () => {
        const primitive = scalar === "String" ? "user-1" : scalar === "Number" ? 12 : true;
        const boxed: object = Object(primitive);
        let hooks = 0;
        for (const key of ["valueOf", "toJSON"]) {
          Object.defineProperty(boxed, key, {
            get() {
              hooks++;
              throw new Error("Caller scalar hooks must not run");
            },
          });
        }
        Object.defineProperty(boxed, "marker", {
          value: "before",
          writable: true,
          enumerable: true,
        });
        const control = scalar === "String"
          ? "user"
          : scalar === "Number"
          ? "max_output_tokens"
          : "parallel_tool_calls";
        let dispatched: ModelRuntimeCallOptions | undefined;
        let recorded: AgentRunEvent | undefined;
        const model: ModelRuntime<ModelRuntimeCallOptions> = {
          provider: cloud ? "veryfront-cloud" : "openai",
          modelId: "gpt-4.1-mini",
          ...(cloud ? { modelProvider: "openai" } : {}),
          specificationVersion: "v3",
          doGenerate(options) {
            dispatched = options;
            return Promise.resolve({
              content: [{ type: "text", text: "ok" }],
              finishReason: "stop",
              usage: {},
            });
          },
          doStream(options) {
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
              transportPlan: { transport: "responses", pinned: true },
            }),
          );
        }
        const sink: AgentRunEventSink = async (event) => {
          if (event.type !== "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED") return;
          recorded = event;
          await Promise.resolve();
          Object.defineProperty(boxed, "marker", { value: "after" });
        };
        const options: Parameters<typeof generateText>[0] = {
          model,
          messages: [{ role: "user", content: "Hello" }],
          providerOptions: { openai: { metadata: { value: boxed }, [control]: boxed } },
        };
        await runWithMandatoryRunEventSink(sink, async () => {
          if (streaming) {
            for await (const _part of streamText(options).fullStream) {
              /* Drain actual dispatch. */
            }
          } else await generateText(options);
        });
        assert(dispatched);
        assert(recorded?.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED");
        if (scalar === "Number") assertEquals(recorded.request?.maxOutputTokens, 12);
        const bucket = dispatched.providerOptions?.openai;
        assert(typeof bucket === "object" && bucket !== null && control in bucket);
        assertEquals(Reflect.get(bucket, control), primitive);
        const request = buildOpenAIResponsesRequest(
          "gpt-4.1-mini",
          "openai",
          dispatched,
          streaming,
          {
            push() {},
            drain() {
              return [];
            },
          },
        );
        assertEquals(JSON.stringify(request.metadata), JSON.stringify({ value: primitive }));
        assertEquals(JSON.stringify(Reflect.get(request, control)), JSON.stringify(primitive));
        assertEquals(hooks, 0);
      });
    }
  }
}

for (
  const surface of [
    "anthropic",
    "google-json-schema",
    "google-response-schema",
    "google-mime-only",
    "google-mime-override",
    "anthropic-schema-extension",
    "google-schema-extension",
  ] as const
) {
  for (const neutral of ["absent", "text", "json-schema", "json"] as const) {
    for (const cloud of [false, true]) {
      for (const streaming of [false, true]) {
        if (surface === "google-mime-only" && neutral === "json-schema") continue;
        if (surface === "google-mime-override" && neutral !== "json") continue;
        if (
          (surface === "anthropic-schema-extension" || surface === "google-schema-extension") &&
          neutral !== "absent"
        ) continue;
        it(`captures effective ${surface} output format with ${neutral} neutral in ${cloud ? "Cloud" : "native"} ${streaming ? "stream" : "generate"}`, async () => {
          const provider = surface === "anthropic" || surface === "anthropic-schema-extension"
            ? "anthropic"
            : "google";
          const nativeSchema = {
            type: "object",
            properties: { native: { type: "string" } },
            ...(surface === "anthropic-schema-extension" || surface === "google-schema-extension"
              ? { jsonSchema: { type: "number" } }
              : {}),
            required: ["native"],
            additionalProperties: false,
          };
          const neutralSchema = {
            type: "object",
            properties: { neutral: { type: "number" } },
            required: ["neutral"],
            additionalProperties: false,
          };
          const providerOptions = provider === "anthropic"
            ? {
              anthropic: {
                output_config: { format: { type: "json_schema", schema: nativeSchema } },
              },
            }
            : {
              google: {
                generationConfig: {
                  responseMimeType: surface === "google-mime-override"
                    ? "text/plain"
                    : "application/json",
                  ...(surface === "google-mime-only" ? {} : {
                    [
                      surface === "google-json-schema" || surface === "google-mime-override" ||
                        surface === "google-schema-extension"
                        ? "responseJsonSchema"
                        : "responseSchema"
                    ]: nativeSchema,
                  }),
                },
              },
            };
          const responseFormat: ModelRuntimeCallOptions["responseFormat"] = neutral === "absent"
            ? undefined
            : neutral === "text"
            ? { type: "text" }
            : neutral === "json"
            ? { type: "json" }
            : {
              type: "json_schema",
              name: "neutral",
              description: "Neutral output",
              strict: true,
              schema: neutralSchema,
            };
          const wireOptions: ModelRuntimeCallOptions = {
            prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
            providerOptions,
            ...(responseFormat ? { responseFormat } : {}),
          };
          function buildWire(options: ModelRuntimeCallOptions) {
            const warnings = {
              push() {},
              drain() {
                return [];
              },
            };
            return provider === "anthropic"
              ? buildAnthropicMessagesRequest(
                "claude-test",
                "anthropic",
                options,
                streaming,
                warnings,
              )
              : buildGoogleGenerateContentRequest("google", options, warnings);
          }
          const originalWire = buildWire(wireOptions);
          const originalConstraint = provider === "anthropic"
            ? originalWire.output_config
            : originalWire.generationConfig;
          assert(typeof originalConstraint === "object" && originalConstraint !== null);
          let recorded: AgentRunEvent | undefined;
          let dispatched: ModelRuntimeCallOptions | undefined;
          const model: ModelRuntime<ModelRuntimeCallOptions> = {
            provider: cloud ? "veryfront-cloud" : provider,
            modelProvider: provider,
            modelId: "format-test",
            specificationVersion: "v3",
            runtimeCapabilities: { structuredOutput: true },
            doGenerate(options) {
              dispatched = options;
              return Promise.resolve({
                content: [{ type: "text", text: "ok" }],
                finishReason: "stop",
                usage: {},
              });
            },
            doStream(options) {
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
                provider,
                surface: provider,
                native: true,
                transportPlan: { transport: "chat-completions", pinned: true },
              }),
            );
          }
          const sink: AgentRunEventSink = (event) => {
            if (event.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED") recorded = event;
          };
          const options: Parameters<typeof generateText>[0] = {
            model,
            messages: [{ role: "user", content: "Hello" }],
            providerOptions,
            ...(responseFormat ? { responseFormat } : {}),
          };
          try {
            await runWithMandatoryRunEventSink(sink, async () => {
              if (streaming) {
                for await (const _part of streamText(options).fullStream) {
                  /* Drain actual dispatch. */
                }
              } else await generateText(options);
            });
          } catch (error) {
            if (surface !== "google-response-schema" || neutral === "json-schema") throw error;
            assert(error instanceof TypeError || error instanceof DurableRunEventPersistenceError);
            assertEquals(recorded, undefined);
            assertEquals(dispatched, undefined);
            return;
          }
          assert(recorded?.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED");
          assert(dispatched);
          const actualWire = buildWire(dispatched);
          assertEquals(
            JSON.stringify(
              provider === "anthropic" ? actualWire.output_config : actualWire.generationConfig,
            ),
            JSON.stringify(originalConstraint),
          );
          const captured = recorded.request?.responseFormat;
          if (surface === "google-mime-only") {
            assertEquals(captured, { type: "json" });
            return;
          }
          assert(
            surface !== "google-response-schema" || neutral === "json-schema",
            "Legacy Gemini responseSchema requires rejection before capture without a JSON Schema override",
          );
          assert(captured?.type === "json_schema");
          if (neutral === "json-schema") {
            assertEquals(captured.name, "neutral");
            assertEquals(captured.description, "Neutral output");
            assertEquals(captured.strict, true);
          }
          const selectedSchema = provider === "anthropic"
            ? Reflect.get(originalConstraint, "format")
            : "responseJsonSchema" in originalConstraint
            ? originalConstraint.responseJsonSchema
            : Reflect.get(originalConstraint, "responseSchema");
          if (provider === "anthropic") {
            assert(
              typeof selectedSchema === "object" && selectedSchema !== null &&
                "schema" in selectedSchema,
            );
            assertEquals(captured.schema, selectedSchema.schema);
          } else assertEquals(captured.schema, selectedSchema);
        });
      }
    }
  }
}

for (const transport of ["chat-completions", "responses"] as const) {
  for (const neutralText of [false, true]) {
    for (const cloud of [false, true]) {
      for (const streaming of [false, true]) {
        it(`captures raw OpenAI ${transport} schema extension with ${neutralText ? "text" : "absent"} neutral in ${cloud ? "Cloud" : "native"} ${streaming ? "stream" : "generate"}`, async () => {
          const schema = {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
            additionalProperties: false,
            jsonSchema: { type: "number" },
          };
          const providerOptions = transport === "chat-completions"
            ? {
              openai: {
                response_format: { type: "json_schema", json_schema: { name: "native", schema } },
              },
            }
            : { openai: { text: { format: { type: "json_schema", name: "native", schema } } } };
          let dispatched: ModelRuntimeCallOptions | undefined;
          let recorded: AgentRunEvent | undefined;
          const model: ModelRuntime<ModelRuntimeCallOptions> = {
            provider: cloud ? "veryfront-cloud" : "openai",
            modelProvider: "openai",
            modelId: "gpt-4.1-mini",
            openAITransport: transport,
            specificationVersion: "v3",
            runtimeCapabilities: { structuredOutput: true },
            doGenerate(options) {
              dispatched = options;
              return Promise.resolve({
                content: [{ type: "text", text: "ok" }],
                finishReason: "stop",
                usage: {},
              });
            },
            doStream(options) {
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
                transportPlan: { transport, pinned: true },
              }),
            );
          }
          const options: Parameters<typeof generateText>[0] = {
            model,
            messages: [{ role: "user", content: "Hello" }],
            providerOptions,
            ...(neutralText ? { responseFormat: { type: "text" } } : {}),
          };
          await runWithMandatoryRunEventSink((event) => {
            if (event.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED") recorded = event;
          }, async () => {
            if (streaming) {
              for await (const _part of streamText(options).fullStream) {
                /* Drain actual dispatch. */
              }
            } else await generateText(options);
          });
          assert(dispatched);
          assert(recorded?.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED");
          const captured = recorded.request?.responseFormat;
          assert(captured?.type === "json_schema");
          assertEquals(captured.schema, schema);
          const warnings = {
            push() {},
            drain() {
              return [];
            },
          };
          const body = transport === "chat-completions"
            ? buildOpenAIChatRequest("gpt-4.1-mini", "openai", dispatched, streaming, warnings)
            : buildOpenAIResponsesRequest(
              "gpt-4.1-mini",
              "openai",
              dispatched,
              streaming,
              warnings,
            );
          let format: unknown;
          if (transport === "chat-completions") {
            const response = Reflect.get(body, "response_format");
            assert(typeof response === "object" && response !== null && "json_schema" in response);
            format = response.json_schema;
          } else {
            const text = Reflect.get(body, "text");
            assert(typeof text === "object" && text !== null && "format" in text);
            format = text.format;
          }
          assert(typeof format === "object" && format !== null && "schema" in format);
          assertEquals(format.schema, schema);
        });
      }
    }
  }
}

for (const surface of ["openai-chat", "openai-responses", "anthropic", "google"] as const) {
  for (const cloud of [false, true]) {
    for (const streaming of [false, true]) {
      it(`captures effective neutral wrapped schema for ${surface} in ${cloud ? "Cloud" : "native"} ${streaming ? "stream" : "generate"}`, async () => {
        const schema = {
          type: "object",
          properties: { answer: { type: "string" } },
          required: ["answer"],
          additionalProperties: false,
          jsonSchema: { type: "number" },
        };
        const provider = surface === "openai-chat" || surface === "openai-responses"
          ? "openai"
          : surface;
        const transport = surface === "openai-responses" ? "responses" : "chat-completions";
        let dispatched: ModelRuntimeCallOptions | undefined;
        let recorded: AgentRunEvent | undefined;
        const model: ModelRuntime<ModelRuntimeCallOptions> = {
          provider: cloud ? "veryfront-cloud" : provider,
          modelProvider: provider,
          modelId: "format-test",
          openAITransport: transport,
          specificationVersion: "v3",
          runtimeCapabilities: { structuredOutput: true },
          doGenerate(options) {
            dispatched = options;
            return Promise.resolve({
              content: [{ type: "text", text: "ok" }],
              finishReason: "stop",
              usage: {},
            });
          },
          doStream(options) {
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
          registerVeryfrontCloudModelFacts(model, () => ({
            provider,
            surface: provider,
            native: true,
            transportPlan: { transport, pinned: true },
          }));
        }
        const options: Parameters<typeof generateText>[0] = {
          model,
          messages: [{ role: "user", content: "Hello" }],
          responseFormat: { type: "json_schema", name: "neutral", schema: { jsonSchema: schema } },
        };
        await runWithMandatoryRunEventSink((event) => {
          if (event.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED") recorded = event;
        }, async () => {
          if (streaming) {
            for await (const _part of streamText(options).fullStream) { /* Drain dispatch. */ }
          } else await generateText(options);
        });
        assert(dispatched);
        assert(recorded?.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED");
        const captured = recorded.request?.responseFormat;
        assert(captured?.type === "json_schema");
        const warnings = {
          push() {},
          drain() {
            return [];
          },
        };
        let effectiveSchema: unknown;
        if (surface === "google") {
          const body = buildGoogleGenerateContentRequest("google", dispatched, warnings);
          const config = Reflect.get(body, "generationConfig");
          assert(typeof config === "object" && config !== null);
          effectiveSchema = Reflect.get(config, "responseJsonSchema");
        } else if (surface === "anthropic") {
          const body = buildAnthropicMessagesRequest(
            "claude-test",
            "anthropic",
            dispatched,
            streaming,
            warnings,
          );
          const config = Reflect.get(body, "output_config");
          assert(typeof config === "object" && config !== null);
          const format = Reflect.get(config, "format");
          assert(typeof format === "object" && format !== null);
          effectiveSchema = Reflect.get(format, "schema");
        } else {
          const body = surface === "openai-chat"
            ? buildOpenAIChatRequest("gpt-4.1-mini", "openai", dispatched, streaming, warnings)
            : buildOpenAIResponsesRequest(
              "gpt-4.1-mini",
              "openai",
              dispatched,
              streaming,
              warnings,
            );
          const config = Reflect.get(body, surface === "openai-chat" ? "response_format" : "text");
          assert(typeof config === "object" && config !== null);
          const format = Reflect.get(config, surface === "openai-chat" ? "json_schema" : "format");
          assert(typeof format === "object" && format !== null);
          effectiveSchema = Reflect.get(format, "schema");
        }
        assert(effectiveSchema !== undefined);
        assertEquals(captured.schema, effectiveSchema);
      });
    }
  }
}

for (const surface of ["openai-chat", "openai-responses"] as const) {
  for (const cloud of [false, true]) {
    for (const streaming of [false, true]) {
      it(`captures effective deeply wrapped neutral schema for ${surface} in ${cloud ? "Cloud" : "native"} ${streaming ? "stream" : "generate"}`, async () => {
        const schema = {
          type: "object",
          jsonSchema: { type: "number", jsonSchema: { type: "boolean" } },
        };
        const provider = surface === "openai-chat" || surface === "openai-responses"
          ? "openai"
          : surface;
        const transport = surface === "openai-responses" ? "responses" : "chat-completions";
        let dispatched: ModelRuntimeCallOptions | undefined;
        let recorded: AgentRunEvent | undefined;
        const model: ModelRuntime<ModelRuntimeCallOptions> = {
          provider: cloud ? "veryfront-cloud" : provider,
          modelProvider: provider,
          modelId: "format-test",
          openAITransport: transport,
          specificationVersion: "v3",
          runtimeCapabilities: { structuredOutput: true },
          doGenerate(options) {
            dispatched = options;
            return Promise.resolve({
              content: [{ type: "text", text: "ok" }],
              finishReason: "stop",
              usage: {},
            });
          },
          doStream(options) {
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
          registerVeryfrontCloudModelFacts(model, () => ({
            provider,
            surface: provider,
            native: true,
            transportPlan: { transport, pinned: true },
          }));
        }
        const options: Parameters<typeof generateText>[0] = {
          model,
          messages: [{ role: "user", content: "Hello" }],
          responseFormat: { type: "json_schema", name: "neutral", schema: { jsonSchema: schema } },
        };
        await runWithMandatoryRunEventSink((event) => {
          if (event.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED") recorded = event;
        }, async () => {
          if (streaming) {
            for await (const _part of streamText(options).fullStream) { /* Drain dispatch. */ }
          } else await generateText(options);
        });
        assert(dispatched);
        assert(recorded?.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED");
        const captured = recorded.request?.responseFormat;
        assert(captured?.type === "json_schema");
        const warnings = {
          push() {},
          drain() {
            return [];
          },
        };
        let effectiveSchema: unknown;
        {
          const body = surface === "openai-chat"
            ? buildOpenAIChatRequest("gpt-4.1-mini", "openai", dispatched, streaming, warnings)
            : buildOpenAIResponsesRequest(
              "gpt-4.1-mini",
              "openai",
              dispatched,
              streaming,
              warnings,
            );
          const config = Reflect.get(body, surface === "openai-chat" ? "response_format" : "text");
          assert(typeof config === "object" && config !== null);
          const format = Reflect.get(config, surface === "openai-chat" ? "json_schema" : "format");
          assert(typeof format === "object" && format !== null);
          effectiveSchema = Reflect.get(format, "schema");
        }
        assert(effectiveSchema !== undefined);
        assertEquals(captured.schema, effectiveSchema);
      });
    }
  }
}

for (const nativeFormat of [false, true]) {
  for (const cloud of [false, true]) {
    for (const streaming of [false, true]) {
      it(`captures effective ${nativeFormat ? "native" : "neutral"} Anthropic nested object schema in ${cloud ? "Cloud" : "native"} ${streaming ? "stream" : "generate"}`, async () => {
        const schema = {
          type: "object",
          properties: {
            answer: { type: "object", properties: { value: { type: "string" } } },
            rows: {
              type: "array",
              items: { type: "object", properties: { id: { type: "number" } } },
            },
            open: { type: "object", properties: {}, additionalProperties: true },
          },
        };
        const provider = "anthropic";
        const transport = "chat-completions";
        let dispatched: ModelRuntimeCallOptions | undefined;
        let recorded: AgentRunEvent | undefined;
        const model: ModelRuntime<ModelRuntimeCallOptions> = {
          provider: cloud ? "veryfront-cloud" : provider,
          modelProvider: provider,
          modelId: "format-test",
          openAITransport: transport,
          specificationVersion: "v3",
          runtimeCapabilities: { structuredOutput: true },
          doGenerate(options) {
            dispatched = options;
            return Promise.resolve({
              content: [{ type: "text", text: "ok" }],
              finishReason: "stop",
              usage: {},
            });
          },
          doStream(options) {
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
          registerVeryfrontCloudModelFacts(model, () => ({
            provider,
            surface: provider,
            native: true,
            transportPlan: { transport, pinned: true },
          }));
        }
        const options: Parameters<typeof generateText>[0] = {
          model,
          messages: [{ role: "user", content: "Hello" }],
          ...(nativeFormat
            ? {
              providerOptions: {
                anthropic: { output_config: { format: { type: "json_schema", schema } } },
              },
            }
            : { responseFormat: { type: "json_schema", name: "neutral", schema } }),
        };
        await runWithMandatoryRunEventSink((event) => {
          if (event.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED") recorded = event;
        }, async () => {
          if (streaming) {
            for await (const _part of streamText(options).fullStream) { /* Drain dispatch. */ }
          } else await generateText(options);
        });
        assert(dispatched);
        assert(recorded?.type === "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED");
        const captured = recorded.request?.responseFormat;
        assert(captured?.type === "json_schema");
        const warnings = {
          push() {},
          drain() {
            return [];
          },
        };
        const body = buildAnthropicMessagesRequest(
          "claude-test",
          "anthropic",
          dispatched,
          streaming,
          warnings,
        );
        const config = Reflect.get(body, "output_config");
        assert(typeof config === "object" && config !== null);
        const format = Reflect.get(config, "format");
        assert(typeof format === "object" && format !== null);
        const effectiveSchema = Reflect.get(format, "schema");
        assert(effectiveSchema !== undefined);
        assertEquals(captured.schema, effectiveSchema);
        if (nativeFormat) assertEquals(effectiveSchema, schema);
      });
    }
  }
}

for (const cloud of [false, true]) {
  for (
    const hostile of ["array-iterator", "set-add", "array-includes", "string-startsWith"] as const
  ) {
    it(`captures Anthropic schema without mutable ${hostile} hooks in ${cloud ? "Cloud" : "native"}`, () => {
      const schema = {
        type: ["object", "null"],
        properties: { answer: { type: "object", properties: { value: { type: "string" } } } },
        $defs: { shared: { type: "object", properties: { id: { type: "number" } } } },
        allOf: [{ $ref: "#/$defs/shared" }],
      };
      const model = {
        provider: cloud ? "veryfront-cloud" : "anthropic",
        modelProvider: "anthropic",
        modelId: "claude-test",
        doGenerate() {
          throw new Error("Capture projection does not dispatch");
        },
        doStream() {
          throw new Error("Capture projection does not dispatch");
        },
      };
      if (cloud) {
        registerVeryfrontCloudModelFacts(model, () => ({
          provider: "anthropic",
          surface: "anthropic",
          native: true,
          transportPlan: { transport: "chat-completions", pinned: true },
        }));
      }
      const options: ModelRuntimeCallOptions = {
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        responseFormat: { type: "json_schema", name: "neutral", schema },
      };
      const target = hostile === "set-add"
        ? Set.prototype
        : hostile === "string-startsWith"
        ? String.prototype
        : Array.prototype;
      const key = hostile === "array-iterator"
        ? Symbol.iterator
        : hostile === "set-add"
        ? "add"
        : hostile === "array-includes"
        ? "includes"
        : "startsWith";
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      assert(descriptor);
      let hooks = 0;
      let request: ReturnType<typeof buildModelCallContextRequest> = undefined;
      let failure: unknown;
      Object.defineProperty(target, key, {
        ...descriptor,
        value() {
          hooks += 1;
          throw new Error("Managed mutable intrinsic hook executed");
        },
      });
      try {
        request = buildModelCallContextRequest(model, options);
      } catch (error) {
        failure = error;
      } finally {
        Object.defineProperty(target, key, descriptor);
      }
      assertEquals(hooks, 0);
      assertEquals(failure, undefined);
      assert(request?.responseFormat?.type === "json_schema");
      const body = buildAnthropicMessagesRequest("claude-test", "anthropic", options, false, {
        push() {},
        drain() {
          return [];
        },
      });
      const output = Reflect.get(body, "output_config");
      assert(typeof output === "object" && output !== null);
      const format = Reflect.get(output, "format");
      assert(typeof format === "object" && format !== null);
      assertEquals(request.responseFormat.schema, Reflect.get(format, "schema"));
    });
  }
}

for (const cloud of [false, true]) {
  for (
    const hostile of ["object-setter", "proto-data"] as const
  ) {
    it(`captures Anthropic schema without mutable ${hostile} hooks in ${cloud ? "Cloud" : "native"}`, () => {
      const schema = {
        type: ["object", "null"],
        properties: { answer: { type: "object", properties: { value: { type: "string" } } } },
        $defs: { shared: { type: "object", properties: { id: { type: "number" } } } },
        allOf: [{ $ref: "#/$defs/shared" }],
      };
      Object.defineProperty(schema.properties, "__proto__", {
        value: { type: "object", properties: { marker: { type: "string" } } },
        enumerable: true,
        writable: true,
        configurable: true,
      });
      const model = {
        provider: cloud ? "veryfront-cloud" : "anthropic",
        modelProvider: "anthropic",
        modelId: "claude-test",
        doGenerate() {
          throw new Error("Capture projection does not dispatch");
        },
        doStream() {
          throw new Error("Capture projection does not dispatch");
        },
      };
      if (cloud) {
        registerVeryfrontCloudModelFacts(model, () => ({
          provider: "anthropic",
          surface: "anthropic",
          native: true,
          transportPlan: { transport: "chat-completions", pinned: true },
        }));
      }
      const options: ModelRuntimeCallOptions = {
        prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
        responseFormat: { type: "json_schema", name: "neutral", schema },
      };
      const target = Object.prototype;
      const key = "additionalProperties";
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      let hooks = 0;
      let request: ReturnType<typeof buildModelCallContextRequest> = undefined;
      let failure: unknown;
      if (hostile === "object-setter") {
        Object.defineProperty(target, key, {
          configurable: true,
          set() {
            hooks += 1;
            throw new Error("Managed inherited setter executed");
          },
        });
      }
      try {
        request = buildModelCallContextRequest(model, options);
      } catch (error) {
        failure = error;
      } finally {
        if (hostile === "object-setter") {
          if (descriptor) Object.defineProperty(target, key, descriptor);
          else Reflect.deleteProperty(target, key);
        }
      }
      assertEquals(hooks, 0);
      assertEquals(failure, undefined);
      assert(request?.responseFormat?.type === "json_schema");
      const body = buildAnthropicMessagesRequest("claude-test", "anthropic", options, false, {
        push() {},
        drain() {
          return [];
        },
      });
      const output = Reflect.get(body, "output_config");
      assert(typeof output === "object" && output !== null);
      const format = Reflect.get(output, "format");
      assert(typeof format === "object" && format !== null);
      const wire = Reflect.get(format, "schema");
      assertEquals(request.responseFormat.schema, wire);
      assert(typeof wire === "object" && wire !== null);
      const properties = Reflect.get(wire, "properties");
      assert(typeof properties === "object" && properties !== null);
      assert(Object.hasOwn(properties, "__proto__"));
      const protoProperty = Reflect.get(properties, "__proto__");
      assert(typeof protoProperty === "object" && protoProperty !== null);
      assertEquals(Reflect.get(protoProperty, "additionalProperties"), false);
    });
  }
}
