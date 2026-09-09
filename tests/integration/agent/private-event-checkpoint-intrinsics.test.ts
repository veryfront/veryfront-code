import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createToolExecutionDataEventBridgeStream,
  type ToolExecutionDataEventPublisher,
} from "#veryfront/agent/streaming/tool-execution-data-event-bridge.ts";
import { AgentRuntime } from "#veryfront/agent/runtime/index.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import type { RuntimeToolFilterConfig } from "#veryfront/agent/runtime/runtime-tool-config.ts";

describe("private events and replay checkpoints", () => {
  it("does not pass named tool data events to a replaced own-property check", async () => {
    const marker = "synthetic-private-tool-event";
    let publish: ToolExecutionDataEventPublisher | undefined;
    let close: (() => void) | undefined;
    const stream = createToolExecutionDataEventBridgeStream({
      baseStream: new ReadableStream({
        start(controller) {
          close = () => controller.close();
        },
      }),
      installPublisher: (publisher) => {
        publish = publisher;
      },
    });
    const hasOwn = Object.hasOwn;
    let observations = 0;
    try {
      Object.hasOwn = (value, property) => {
        if ((value as { value?: unknown })?.value === marker) observations++;
        return hasOwn(value, property);
      };
      publish!({ type: "data", name: "synthetic", value: marker });
    } finally {
      Object.hasOwn = hasOwn;
      close!();
    }
    assertStringIncludes(await new Response(stream).text(), marker);
    assertEquals(observations, 0);
  });

  it("does not expose initial replay checkpoints to a replaced array find", async () => {
    const checkpoints: NonNullable<RuntimeToolFilterConfig["__vfProviderReplayCheckpoints"]> = [{
      version: 1,
      messageId: "assistant-synthetic",
      provider: "anthropic",
      providerBlocks: [{
        type: "provider-block",
        provider: "anthropic",
        block: { type: "text", text: "synthetic-private-replay" },
      }],
      providerBlockPositions: [0],
      totalPartCount: 1,
    }];
    const config: RuntimeToolFilterConfig = {
      model: "veryfront-cloud/anthropic/synthetic",
      system: "Synthetic instructions",
      __vfProviderReplayCheckpoints: checkpoints,
      __vfProviderReplayCheckpointMessageId: "assistant-synthetic",
    };
    const model = scriptedModel([{ text: "Complete" }], { only: "generate", provider: "anthropic" });
    const runtime = new AgentRuntime("synthetic", config, { resolveModelRuntime: () => model });
    const find = Array.prototype.find;
    let observations = 0;
    let result;
    try {
      Array.prototype.find = function (...args: unknown[]) {
        if (this === checkpoints) observations++;
        return Reflect.apply(find, this, args);
      };
      result = await runtime.generate("Synthetic request");
    } finally {
      Array.prototype.find = find;
    }
    assertEquals(result?.text, "Complete");
    assertEquals(observations, 0);
  });
});
