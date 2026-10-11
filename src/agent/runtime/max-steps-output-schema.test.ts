import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { tool } from "#veryfront/tool";
import { agent } from "../factory.ts";
import type { AgentConfig } from "../types.ts";
import { createInvokeAgentTool } from "./agent-delegation.ts";
import type { RuntimeToolFilterConfig } from "./runtime-tool-config.ts";
import { withLocalChildExecution } from "../composition/local-child-execution.ts";

const getReportSchema = defineSchema((v) => v.object({ city: v.string(), tempC: v.number() }));
const discardReportSchema = defineSchema((v) =>
  v.object({ city: v.string() }).transform(() => undefined)
);
const dateReportSchema = defineSchema((v) =>
  v.object({ city: v.string() }).transform(() => new Date("2026-01-01T00:00:00.000Z"))
);
const deepReportSchema = defineSchema((v) =>
  v.object({ city: v.string() }).transform(() => {
    let output: Record<string, unknown> = { city: "Berlin" };
    for (let index = 0; index < 64; index++) {
      output = { child: output };
    }
    return output;
  })
);
const sparseArrayReportSchema = defineSchema((v) =>
  v.object({ city: v.string() }).transform(() => new Array(128))
);
const sharedReferenceReportSchema = defineSchema((v) =>
  v.object({ city: v.string() }).transform(() => {
    const shared = { city: "Berlin" };
    return { left: shared, right: shared };
  })
);
const wideReportSchema = defineSchema((v) =>
  v.object({ city: v.string() }).transform(() => {
    const output: Record<string, unknown> = {};
    for (let index = 0; index < 128; index++) {
      output[`item${index}`] = index;
    }
    return output;
  })
);

const noopTool = tool({
  id: "max_steps_noop_tool",
  description: "Succeeds without side effects",
  inputSchema: defineSchema((v) => v.object({}))(),
  execute: () => ({ ok: true }),
});

function eventTypes(events: ReadonlyArray<Record<string, unknown>>): string[] {
  return events.map((event) => String(event.type));
}

function countEvents(events: ReadonlyArray<Record<string, unknown>>, type: string): number {
  return events.filter((event) => event.type === type).length;
}

function eventIndex(events: ReadonlyArray<Record<string, unknown>>, type: string): number {
  return eventTypes(events).indexOf(type);
}

/**
 * A model that always answers with text plus a tool call, so the agent loop
 * never finishes on its own and exits through the max-steps path.
 */
function createMaxStepsModel(
  text: string,
  toolName = "max_steps_noop_tool",
  generateToolInput: unknown = "{}",
  streamToolInput: unknown = {},
  providerMetadata?: Record<string, unknown>,
): ModelRuntime<ModelRuntimeCallOptions> {
  let call = 0;
  return {
    provider: "test",
    modelId: "test/max-steps",
    executionMode: "remote",
    runtimeCapabilities: { structuredOutput: true },
    doGenerate() {
      call++;
      return Promise.resolve({
        content: [
          { type: "text", text },
          {
            type: "tool-call",
            toolCallId: `call-${call}`,
            toolName,
            input: generateToolInput,
          },
        ],
        finishReason: "tool-calls" as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        ...(providerMetadata === undefined ? {} : { providerMetadata }),
      });
    },
    doStream() {
      call++;
      const parts: unknown[] = [
        { type: "text-delta", text },
        {
          type: "tool-call",
          toolCallId: `call-${call}`,
          toolName,
          input: streamToolInput,
        },
        {
          type: "finish",
          finishReason: "tool-calls",
          totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          ...(providerMetadata === undefined ? {} : { providerMetadata }),
        },
      ];
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      });
    },
  };
}

describe("agent max steps output schema", () => {
  it("surfaces the outputSchema parse failure in metadata on the max-steps exit", async () => {
    const model = createMaxStepsModel("Twelve degrees in Berlin.");
    const assistant = agent({
      id: "max-steps-unparsable",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    const response = await assistant.generate({ input: "Berlin?" });

    assertEquals(response.metadata?.warning, "Max steps (1) reached");
    assertEquals(response.object, undefined);
    assertStringIncludes(
      String(response.metadata?.outputSchemaError),
      "is not valid JSON for its outputSchema",
    );
    assertEquals(response.text, "Twelve degrees in Berlin.");
  });

  it("surfaces the outputSchema validation failure in metadata on the max-steps exit", async () => {
    const model = createMaxStepsModel('{"city":"Berlin"}');
    const assistant = agent({
      id: "max-steps-invalid",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    const response = await assistant.generate({ input: "Berlin?" });

    assertEquals(response.metadata?.warning, "Max steps (1) reached");
    assertEquals(response.object, undefined);
    assertStringIncludes(
      String(response.metadata?.outputSchemaError),
      "failed outputSchema validation",
    );
  });

  it("surfaces an empty structured output on the max-steps exit", async () => {
    const model = createMaxStepsModel("");
    const assistant = agent({
      id: "max-steps-empty",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    const response = await assistant.generate({ input: "Berlin?" });

    assertEquals(response.metadata?.warning, "Max steps (1) reached");
    assertEquals(response.object, undefined);
    assertStringIncludes(
      String(response.metadata?.outputSchemaError),
      "is not valid JSON for its outputSchema",
    );
    assertEquals(response.text, "");
  });

  it("keeps the parsed object and adds no error when the final text satisfies the schema", async () => {
    const model = createMaxStepsModel('{"city":"Berlin","tempC":12}');
    const assistant = agent({
      id: "max-steps-parsable",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    const response = await assistant.generate({ input: "Berlin?" });

    assertEquals(response.metadata?.warning, "Max steps (1) reached");
    assertEquals(response.metadata?.outputSchemaError, undefined);
    assertEquals(response.object, { city: "Berlin", tempC: 12 });
  });

  it("parses the final max-step object after the final tool completes", async () => {
    let toolCompleted = false;
    let transformCalls = 0;
    const statefulReportSchema = defineSchema((v) =>
      v.object({ city: v.string(), tempC: v.number() }).transform((report) => {
        transformCalls += 1;
        return { ...report, toolCompleted };
      })
    );
    const statefulToolName = "max_steps_stateful_tool";
    const statefulTool = tool({
      id: statefulToolName,
      description: "Marks the final tool complete",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => {
        toolCompleted = true;
        return { ok: true };
      },
    });
    const model = createMaxStepsModel('{"city":"Berlin","tempC":12}', statefulToolName);
    const assistant = agent({
      id: "max-steps-final-tool-stateful-transform",
      system: "You report weather.",
      tools: { [statefulToolName]: statefulTool },
      maxSteps: 1,
      outputSchema: statefulReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const observed: Array<Record<string, unknown>> = [];

    const response = await withLocalChildExecution(
      (input) => input.execute(),
      () => assistant.generate({ input: "Berlin?" }),
      (event) => {
        observed.push(event as Record<string, unknown>);
        return Promise.resolve();
      },
    );

    assertEquals(response.object, { city: "Berlin", tempC: 12, toolCompleted: true });
    assertEquals(transformCalls, 1);
    assertEquals(eventTypes(observed), [
      "message-start",
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-start",
      "tool-input-available",
      "tool-output-available",
      "message-finish",
    ]);
    assertEquals(
      observed.filter((event) => event.type === "message-finish"),
      [{
        type: "message-finish",
        finishReason: "tool-calls",
        totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        object: { city: "Berlin", tempC: 12, toolCompleted: true },
      }],
    );
  });

  it("admits final max-step child delegation before parsing after the child completes", async () => {
    let childDelegations = 0;
    let childCompleted = false;
    let transformCalls = 0;
    const delegatedReportSchema = defineSchema((v) =>
      v.object({ city: v.string(), tempC: v.number() }).transform((report) => {
        transformCalls += 1;
        return { ...report, childCompleted };
      })
    );
    const childModel: ModelRuntime<ModelRuntimeCallOptions> = {
      provider: "test",
      modelId: "test/max-steps-child",
      executionMode: "remote",
      doGenerate() {
        childCompleted = true;
        return Promise.resolve({
          content: [{ type: "text", text: "child complete" }],
          finishReason: "stop" as const,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        });
      },
      doStream() {
        const parts: unknown[] = [
          { type: "text-delta", text: "child complete" },
          {
            type: "finish",
            finishReason: "stop",
            totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ];
        return Promise.resolve({
          stream: new ReadableStream<unknown>({
            start(controller) {
              for (const part of parts) controller.enqueue(part);
              childCompleted = true;
              controller.close();
            },
          }),
        });
      },
    };
    const child = agent({
      id: "max-steps-child",
      system: "Complete delegated child work.",
      resolveModelTransport: () => Promise.resolve({ model: childModel }),
    });
    const invokeInput = {
      agent_id: "max-steps-child",
      description: "Complete child",
      prompt: "Run child work",
      context: {},
    };
    const model = createMaxStepsModel(
      '{"city":"Berlin","tempC":12}',
      "invoke_agent",
      invokeInput,
      invokeInput,
    );
    const assistant = agent({
      id: "max-steps-final-child-delegation",
      system: "Delegate then report weather.",
      tools: {
        invoke_agent: createInvokeAgentTool({
          resolveAgent: (agentId) => agentId === child.id ? child : undefined,
        }),
      },
      maxSteps: 1,
      outputSchema: delegatedReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const observed: Array<Record<string, unknown>> = [];

    const response = await withLocalChildExecution(
      async (input) => {
        childDelegations += 1;
        assertEquals(input.agentId, "max-steps-child");
        assertEquals(input.toolName, "invoke_agent");
        assertEquals(input.toolInput, invokeInput);
        const result = await input.execute();
        childCompleted = true;
        return result;
      },
      () => assistant.generate({ input: "Berlin?" }),
      (event) => {
        observed.push(event as Record<string, unknown>);
        return Promise.resolve();
      },
    );

    assertEquals(childDelegations, 1);
    assertEquals(response.object, { city: "Berlin", tempC: 12, childCompleted: true });
    assertEquals(transformCalls, 1);
    assertEquals(eventTypes(observed), [
      "message-start",
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-start",
      "tool-input-available",
      "tool-output-available",
      "message-finish",
    ]);
    assertEquals(
      observed.filter((event) => event.type === "message-finish"),
      [{
        type: "message-finish",
        finishReason: "tool-calls",
        totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        object: { city: "Berlin", tempC: 12, childCompleted: true },
      }],
    );
  });

  it("emits one raw finish when final max-step tool admission aborts", async () => {
    const abortController = new AbortController();
    const abortReason = new DOMException("admission aborted", "AbortError");
    let transformCalls = 0;
    const statefulReportSchema = defineSchema((v) =>
      v.object({ city: v.string(), tempC: v.number() }).transform((report) => {
        transformCalls += 1;
        return report;
      })
    );
    const model = createMaxStepsModel('{"city":"Berlin","tempC":12}');
    const assistant = agent({
      id: "max-steps-admission-abort-finish",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: statefulReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const observed: Array<Record<string, unknown>> = [];

    await assertRejects(() =>
      withLocalChildExecution(
        (input) => input.execute(),
        () => assistant.generate({ input: "Berlin?", abortSignal: abortController.signal }),
        (event) => {
          observed.push(event as Record<string, unknown>);
          if (event.type === "tool-input-available") abortController.abort(abortReason);
          return Promise.resolve();
        },
      )
    );

    assertEquals(transformCalls, 0);
    assertEquals(eventTypes(observed), [
      "message-start",
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-start",
      "tool-input-available",
      "message-finish",
    ]);
    assertEquals(
      observed.filter((event) => event.type === "message-finish"),
      [{
        type: "message-finish",
        finishReason: "tool-calls",
        totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }],
    );
  });

  it("does not replay final max-step admission when the observer rejects", async () => {
    const observerFailure = new Error("observer rejected admission");
    let rejected = false;
    let transformCalls = 0;
    const statefulReportSchema = defineSchema((v) =>
      v.object({ city: v.string(), tempC: v.number() }).transform((report) => {
        transformCalls += 1;
        return report;
      })
    );
    const model = createMaxStepsModel('{"city":"Berlin","tempC":12}');
    const assistant = agent({
      id: "max-steps-admission-observer-reject",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: statefulReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const observed: Array<Record<string, unknown>> = [];

    const error = await withLocalChildExecution(
      (input) => input.execute(),
      async () => {
        try {
          await assistant.generate({ input: "Berlin?" });
        } catch (caught) {
          return caught;
        }
        throw new Error("expected observer failure");
      },
      (event) => {
        observed.push(event as Record<string, unknown>);
        if (event.type === "tool-input-available" && !rejected) {
          rejected = true;
          return Promise.reject(observerFailure);
        }
        return Promise.resolve();
      },
    );

    assertStrictEquals(error, observerFailure);
    assertEquals(transformCalls, 0);
    assertEquals(eventTypes(observed), [
      "message-start",
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-start",
      "tool-input-available",
    ]);
  });

  it("emits one raw finish when final max-step replay checkpoint persistence fails", async () => {
    const checkpointFailure = new Error("checkpoint persistence rejected");
    let transformCalls = 0;
    const statefulReportSchema = defineSchema((v) =>
      v.object({ city: v.string(), tempC: v.number() }).transform((report) => {
        transformCalls += 1;
        return report;
      })
    );
    const model = createMaxStepsModel(
      '{"city":"Berlin","tempC":12}',
      "max_steps_noop_tool",
      "{}",
      {},
      {
        anthropic: {
          rawAssistantMessages: [[{ type: "thinking", thinking: "", signature: "sig" }]],
        },
      },
    );
    const config = {
      id: "max-steps-checkpoint-failure-finish",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: statefulReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
      __vfProviderReplayCheckpointMessageId: "max-steps-checkpoint-message",
      __vfProviderReplayCheckpointPersistenceRequired: true,
      __vfPersistProviderReplayCheckpoint: () => {
        throw checkpointFailure;
      },
    } as AgentConfig & RuntimeToolFilterConfig;
    const assistant = agent(config);
    const observed: Array<Record<string, unknown>> = [];

    const error = await withLocalChildExecution(
      (input) => input.execute(),
      async () => {
        try {
          await assistant.generate({ input: "Berlin?" });
        } catch (caught) {
          return caught;
        }
        throw new Error("expected checkpoint persistence failure");
      },
      (event) => {
        observed.push(event as Record<string, unknown>);
        return Promise.resolve();
      },
    );

    assertStrictEquals(error, checkpointFailure);
    assertEquals(transformCalls, 0);
    assertEquals(eventTypes(observed), [
      "message-start",
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-start",
      "tool-input-available",
      "message-finish",
    ]);
    assertEquals(
      observed.filter((event) => event.type === "message-finish"),
      [{
        type: "message-finish",
        finishReason: "tool-calls",
        totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }],
    );
  });

  it("does not transform the final max-step output when the final tool aborts", async () => {
    let transformCalls = 0;
    const abortController = new AbortController();
    const abortReason = new DOMException("final tool aborted", "AbortError");
    const statefulReportSchema = defineSchema((v) =>
      v.object({ city: v.string(), tempC: v.number() }).transform((report) => {
        transformCalls += 1;
        return report;
      })
    );
    const abortingToolName = "max_steps_aborting_tool";
    const abortingTool = tool({
      id: abortingToolName,
      description: "Aborts during the final max-step tool turn",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => {
        abortController.abort(abortReason);
        throw abortReason;
      },
    });
    const model = createMaxStepsModel('{"city":"Berlin","tempC":12}', abortingToolName);
    const assistant = agent({
      id: "max-steps-final-tool-abort-transform",
      system: "You report weather.",
      tools: { [abortingToolName]: abortingTool },
      maxSteps: 1,
      outputSchema: statefulReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const observed: Array<Record<string, unknown>> = [];

    await assertRejects(() =>
      withLocalChildExecution(
        (input) => input.execute(),
        () => assistant.generate({ input: "Berlin?", abortSignal: abortController.signal }),
        (event) => {
          observed.push(event as Record<string, unknown>);
          return Promise.resolve();
        },
      )
    );

    assertEquals(transformCalls, 0);
    assertEquals(countEvents(observed, "message-start"), 1);
    assertEquals(countEvents(observed, "text-start"), 1);
    assertEquals(countEvents(observed, "text-delta"), 1);
    assertEquals(countEvents(observed, "text-end"), 1);
    assertEquals(countEvents(observed, "message-finish"), 1);
    const toolInputAvailableIndex = eventIndex(observed, "tool-input-available");
    const toolOutputAvailableIndex = eventIndex(observed, "tool-output-available");
    const messageFinishIndex = eventIndex(observed, "message-finish");
    assertEquals(toolInputAvailableIndex >= 0, true);
    assertEquals(messageFinishIndex > toolInputAvailableIndex, true);
    if (toolOutputAvailableIndex >= 0) {
      assertEquals(toolInputAvailableIndex < toolOutputAvailableIndex, true);
      assertEquals(toolOutputAvailableIndex < messageFinishIndex, true);
    }
    assertEquals(
      observed.filter((event) => event.type === "message-finish"),
      [{
        type: "message-finish",
        finishReason: "tool-calls",
        totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }],
    );
  });

  it("observes the parsed object on the final generated tool turn before max-steps exit", async () => {
    const model = createMaxStepsModel('{"city":"Berlin","tempC":12}');
    const assistant = agent({
      id: "max-steps-observed-parsed-object",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const observed: Array<Record<string, unknown>> = [];

    const response = await withLocalChildExecution(
      (input) => input.execute(),
      () => assistant.generate({ input: "Berlin?" }),
      (event) => {
        observed.push(event as Record<string, unknown>);
        return Promise.resolve();
      },
    );

    assertEquals(response.object, { city: "Berlin", tempC: 12 });
    assertEquals(
      observed.filter((event) => event.type === "message-finish"),
      [{
        type: "message-finish",
        finishReason: "tool-calls",
        totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        object: { city: "Berlin", tempC: 12 },
      }],
    );
  });

  it("marks non-plain parsed objects unsupported in max-steps observations", async () => {
    const model = createMaxStepsModel('{"city":"Berlin"}');
    const assistant = agent({
      id: "max-steps-observed-unsupported-object",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: dateReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const observed: Array<Record<string, unknown>> = [];

    const response = await withLocalChildExecution(
      (input) => input.execute(),
      () => assistant.generate({ input: "Berlin?" }),
      (event) => {
        observed.push(event as Record<string, unknown>);
        return Promise.resolve();
      },
    );

    assertEquals(response.object, new Date("2026-01-01T00:00:00.000Z"));
    assertEquals(
      observed.filter((event) => event.type === "message-finish"),
      [{
        type: "message-finish",
        finishReason: "tool-calls",
        totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        object: {
          captureStatus: "unsupported",
          reasons: ["unsupported_object"],
          value: "[unsupported object]",
        },
      }],
    );
  });

  it("marks deeply nested parsed objects partial in max-steps observations", async () => {
    const model = createMaxStepsModel('{"city":"Berlin"}');
    const assistant = agent({
      id: "max-steps-observed-deep-object",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: deepReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const observed: Array<Record<string, unknown>> = [];

    const response = await withLocalChildExecution(
      (input) => input.execute(),
      () => assistant.generate({ input: "Berlin?" }),
      (event) => {
        observed.push(event as Record<string, unknown>);
        return Promise.resolve();
      },
    );

    assertEquals(typeof response.object, "object");
    const [finish] = observed.filter((event) => event.type === "message-finish");
    assertEquals((finish?.object as Record<string, unknown> | undefined)?.captureStatus, "partial");
    assertEquals((finish?.object as Record<string, unknown> | undefined)?.reasons, ["max_depth"]);
  });

  it("marks sparse array parsed objects partial in max-steps observations", async () => {
    const model = createMaxStepsModel('{"city":"Berlin"}');
    const assistant = agent({
      id: "max-steps-observed-sparse-array",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: sparseArrayReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const observed: Array<Record<string, unknown>> = [];

    await withLocalChildExecution(
      (input) => input.execute(),
      () => assistant.generate({ input: "Berlin?" }),
      (event) => {
        observed.push(event as Record<string, unknown>);
        return Promise.resolve();
      },
    );

    const [finish] = observed.filter((event) => event.type === "message-finish");
    const object = finish?.object as Record<string, unknown> | undefined;
    assertEquals(object?.captureStatus, "partial");
    assertEquals(object?.reasons, ["array_truncated"]);
  });

  it("marks repeated parsed object references partial without expanding them", async () => {
    const model = createMaxStepsModel('{"city":"Berlin"}');
    const assistant = agent({
      id: "max-steps-observed-shared-reference",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: sharedReferenceReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const observed: Array<Record<string, unknown>> = [];

    await withLocalChildExecution(
      (input) => input.execute(),
      () => assistant.generate({ input: "Berlin?" }),
      (event) => {
        observed.push(event as Record<string, unknown>);
        return Promise.resolve();
      },
    );

    const [finish] = observed.filter((event) => event.type === "message-finish");
    const object = finish?.object as Record<string, unknown> | undefined;
    assertEquals(object?.captureStatus, "partial");
    assertEquals(object?.reasons, ["circular"]);
  });

  it("marks wide parsed objects partial in max-steps observations", async () => {
    const model = createMaxStepsModel('{"city":"Berlin"}');
    const assistant = agent({
      id: "max-steps-observed-wide-object",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: wideReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    const observed: Array<Record<string, unknown>> = [];

    await withLocalChildExecution(
      (input) => input.execute(),
      () => assistant.generate({ input: "Berlin?" }),
      (event) => {
        observed.push(event as Record<string, unknown>);
        return Promise.resolve();
      },
    );

    const [finish] = observed.filter((event) => event.type === "message-finish");
    const object = finish?.object as Record<string, unknown> | undefined;
    assertEquals(object?.captureStatus, "partial");
    assertEquals(object?.reasons, ["object_keys_truncated"]);
  });

  it("preserves object presence when a successful schema transform returns undefined", async () => {
    const model = createMaxStepsModel('{"city":"Berlin"}');
    const assistant = agent({
      id: "max-steps-undefined-transform",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: discardReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    const response = await assistant.generate({ input: "Berlin?" });

    assertEquals("object" in response, true);
    assertEquals(response.object, undefined);
    assertEquals(response.metadata?.outputSchemaError, undefined);
  });

  it("streams the partial response with outputSchemaError when the step budget runs out", async () => {
    const model = createMaxStepsModel("Twelve degrees in Berlin.");
    const assistant = agent({
      id: "max-steps-stream-unparsable",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    let finished: Record<string, unknown> | undefined;
    const result = await assistant.stream({
      input: "Berlin?",
      onFinish: (response) => {
        finished = response as unknown as Record<string, unknown>;
      },
    });
    const body = await result.toDataStreamResponse().text();

    assertEquals(body.includes('"type":"error"'), false);
    const metadata = finished?.metadata as Record<string, unknown> | undefined;
    assertEquals(metadata?.warning, "Max steps (1) reached");
    assertStringIncludes(
      String(metadata?.outputSchemaError),
      "is not valid JSON for its outputSchema",
    );
    assertEquals(finished?.object, undefined);
    assertEquals(finished?.text, "Twelve degrees in Berlin.");
  });

  it("streams outputSchemaError when interrupted local tool recovery runs out of steps", async () => {
    let call = 0;
    const model: ModelRuntime<ModelRuntimeCallOptions> = {
      provider: "test",
      modelId: "test/max-steps-interrupted-local-tool",
      executionMode: "remote",
      runtimeCapabilities: { structuredOutput: true },
      doGenerate() {
        throw new Error("stream test must not call doGenerate");
      },
      doStream() {
        call++;
        const parts: unknown[] = call === 1
          ? [
            {
              type: "tool-call",
              toolCallId: "committed-call",
              toolName: "max_steps_noop_tool",
              input: {},
            },
            {
              type: "finish",
              finishReason: "tool-calls",
              totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ]
          : [
            {
              type: "tool-input-start",
              id: "interrupted-call",
              toolName: "max_steps_noop_tool",
            },
            {
              type: "tool-input-delta",
              id: "interrupted-call",
              delta: '{"revision":"trunc',
            },
            {
              type: "finish",
              finishReason: "tool-calls",
              totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ];
        return Promise.resolve({
          stream: new ReadableStream<unknown>({
            start(controller) {
              for (const part of parts) controller.enqueue(part);
              controller.close();
            },
          }),
        });
      },
    };
    const assistant = agent({
      id: "max-steps-stream-interrupted-local-tool",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 2,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    let finished: Record<string, unknown> | undefined;
    const result = await assistant.stream({
      input: "Berlin?",
      onFinish: (response) => {
        finished = response as unknown as Record<string, unknown>;
      },
    });
    const body = await result.toDataStreamResponse().text();

    assertEquals(call, 2);
    assertEquals(body.includes('"type":"error"'), false);
    const metadata = finished?.metadata as Record<string, unknown> | undefined;
    assertEquals(metadata?.warning, "Max steps (2) reached");
    assertStringIncludes(
      String(metadata?.outputSchemaError),
      "is not valid JSON for its outputSchema",
    );
    assertEquals(finished?.object, undefined);
  });

  it("streams the parsed object when the final text satisfies the schema at the step budget", async () => {
    const model = createMaxStepsModel('{"city":"Berlin","tempC":12}');
    const assistant = agent({
      id: "max-steps-stream-parsable",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: getReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    let finished: Record<string, unknown> | undefined;
    const result = await assistant.stream({
      input: "Berlin?",
      onFinish: (response) => {
        finished = response as unknown as Record<string, unknown>;
      },
    });
    await result.toDataStreamResponse().text();

    const metadata = finished?.metadata as Record<string, unknown> | undefined;
    assertEquals(metadata?.warning, "Max steps (1) reached");
    assertEquals(metadata?.outputSchemaError, undefined);
    assertEquals(finished?.object, { city: "Berlin", tempC: 12 });
  });

  it("streams object presence when a successful schema transform returns undefined", async () => {
    const model = createMaxStepsModel('{"city":"Berlin"}');
    const assistant = agent({
      id: "max-steps-stream-undefined-transform",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      outputSchema: discardReportSchema(),
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    let finished: Record<string, unknown> | undefined;
    const result = await assistant.stream({
      input: "Berlin?",
      onFinish: (response) => {
        finished = response as unknown as Record<string, unknown>;
      },
    });
    await result.toDataStreamResponse().text();

    assertEquals(finished !== undefined && "object" in finished, true);
    assertEquals(finished?.object, undefined);
    const metadata = finished?.metadata as Record<string, unknown> | undefined;
    assertEquals(metadata?.outputSchemaError, undefined);
  });

  it("adds no outputSchemaError when the agent has no outputSchema", async () => {
    const model = createMaxStepsModel("Twelve degrees in Berlin.");
    const assistant = agent({
      id: "max-steps-no-schema",
      system: "You report weather.",
      tools: { max_steps_noop_tool: noopTool },
      maxSteps: 1,
      resolveModelTransport: () => Promise.resolve({ model }),
    });

    const response = await assistant.generate({ input: "Berlin?" });

    assertEquals(response.metadata?.warning, "Max steps (1) reached");
    assertEquals(response.metadata?.outputSchemaError, undefined);
    assertEquals(response.object, undefined);
  });
});
