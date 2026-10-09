import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "@std/assert";
import { ConversationRunEventEncoder } from "../conversation/run-events.ts";
import { readConversationRunLifecycleFrames } from "../conversation/legacy-run-read-adapter.ts";
import {
  createMirroredToolChunkState,
  recordMirroredToolChunkState,
} from "../streaming/mirrored-tool-chunk-state.ts";
import {
  buildDetachedFallbackChunks,
  buildDetachedFallbackMessageState,
  buildFinalizedMessageFallbackChunks,
  buildFinalizedMessageState,
  buildToolResultOwnershipCorrectionEvents,
} from "./finalized-message.ts";

Deno.test("buildFinalizedMessageState builds fallback parts for an empty finalized assistant message", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [],
    },
    isAborted: false,
    finalStep: { text: "Done" },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.persistedMessage.parts, []);
  assertEquals(result.sanitizedFinalizedMessage.parts, [{ type: "text", text: "Done" }]);
  assertEquals(result.hasIncompleteFinalizedToolParts, false);
});

Deno.test("buildFinalizedMessageState preserves tool-before-text fallback ordering after runtime metadata", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "data-veryfront.runtime_context", data: { currentDateUtc: "2026-10-07" } }],
    },
    isAborted: false,
    finalStep: {
      text: "Done",
      toolCalls: [{ toolCallId: "call-1", toolName: "form_input", input: { title: "Continue?" } }],
      toolResults: [{ toolCallId: "call-1", toolName: "form_input", output: { submitted: true } }],
    },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.sanitizedFinalizedMessage.parts.map((part) => part.type), [
    "data-veryfront.runtime_context",
    "dynamic-tool",
    "text",
  ]);
  assertEquals(result.hasIncompleteFinalizedToolParts, false);
});

Deno.test("buildFinalizedMessageState matches persisted reasoning fallbacks one at a time", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "data-veryfront.runtime_context", data: { currentDateUtc: "2026-10-07" } },
        {
          type: "reasoning",
          text: "Checking the retained state.",
          signature: "sig_123",
        },
      ],
    },
    isAborted: false,
    finalStep: {
      response: {
        messages: [{
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "Checking the retained state.",
              signature: "sig_123",
            },
            {
              type: "reasoning",
              text: "Checking the retained state.",
              signature: "sig_123",
            },
          ],
        }],
      },
    },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.sanitizedFinalizedMessage.parts, [
    { type: "data-veryfront.runtime_context", data: { currentDateUtc: "2026-10-07" } },
    {
      type: "reasoning",
      text: "Checking the retained state.",
      signature: "sig_123",
    },
    {
      type: "reasoning",
      text: "Checking the retained state.",
      signature: "sig_123",
    },
  ]);
  assertEquals(result.hasIncompleteFinalizedToolParts, false);
});

Deno.test("buildFinalizedMessageState preserves text-before-tool fallback ordering after runtime metadata", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "data-veryfront.runtime_context", data: { currentDateUtc: "2026-10-07" } }],
    },
    isAborted: false,
    finalStep: {
      response: {
        messages: [{
          role: "assistant",
          content: [
            { type: "text", text: "Checking now." },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "form_input",
              input: { title: "Continue?" },
            },
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "form_input",
              output: { submitted: true },
            },
          ],
        }],
      },
    },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.sanitizedFinalizedMessage.parts.map((part) => part.type), [
    "data-veryfront.runtime_context",
    "text",
    "dynamic-tool",
  ]);
  assertEquals(result.hasIncompleteFinalizedToolParts, false);
});

Deno.test("buildFinalizedMessageState does not fail provider-owned input-available tools", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "text", text: "Done" },
        {
          type: "tool-web_fetch",
          toolCallId: "srvtoolu-fetch",
          input: { url: "https://example.com/docs" },
          state: "input-available",
          providerExecuted: true,
        },
      ],
    },
    isAborted: false,
    finalStep: { text: "Done" },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.hasIncompleteFinalizedToolParts, false);
  assertEquals(result.sanitizedFinalizedMessage.parts, [
    { type: "text", text: "Done" },
    {
      type: "tool-web_fetch",
      toolCallId: "srvtoolu-fetch",
      input: { url: "https://example.com/docs" },
      state: "input-available",
      providerExecuted: true,
    },
  ]);
});

Deno.test("buildFinalizedMessageState fails local web_fetch input-available tools without providerExecuted", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "text", text: "Done" },
        {
          type: "tool-web_fetch",
          toolCallId: "srvtoolu-fetch",
          input: { url: "https://veryfront.com/docs/agent/create-agent" },
          state: "input-available",
        },
      ],
    },
    isAborted: false,
    finalStep: { text: "Done" },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.hasIncompleteFinalizedToolParts, true);
  assertEquals(result.sanitizedFinalizedMessage.parts, [
    { type: "text", text: "Done" },
    {
      type: "tool-web_fetch",
      toolCallId: "srvtoolu-fetch",
      input: { url: "https://veryfront.com/docs/agent/create-agent" },
      state: "output-error",
      errorText: "tool error",
    },
  ]);
});

Deno.test("buildFinalizedMessageState marks incomplete tool parts as stopped instead of errored when aborted", () => {
  const result = buildFinalizedMessageState({
    responseMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "tool-bash",
          toolCallId: "call-1",
          input: { command: "ls" },
          state: "input-available",
        },
      ],
    },
    isAborted: true,
    finalStep: { text: "" },
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(
    result.hasIncompleteFinalizedToolParts,
    false,
    "aborted runs must not be flagged as incomplete tool failures",
  );
  assertEquals(
    result.persistedMessage.parts,
    [
      {
        type: "tool-bash",
        toolCallId: "call-1",
        input: { command: "ls" },
        state: "output-error",
        errorText: "Stopped by user",
      },
    ],
    "aborted persisted message must carry the stopped tool part",
  );
  assertEquals(
    result.sanitizedFinalizedMessage.parts,
    result.persistedMessage.parts,
    "aborted runs must not convert tool parts to the tool error text",
  );
});

Deno.test("buildDetachedFallbackMessageState leaves unfinished tool calls untouched when aborted", () => {
  const result = buildDetachedFallbackMessageState({
    capturedMessageId: "captured-1",
    finalStep: {
      text: "",
      toolCalls: [{ toolCallId: "call-1", toolName: "bash", input: { command: "ls" } }],
    },
    isAborted: true,
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(
    result.hasIncompleteFallbackToolParts,
    false,
    "aborted detached runs must not be flagged as incomplete tool failures",
  );
  assertEquals(
    result.finalizedFallbackMessage.parts.some((part) =>
      "state" in part && part.state === "output-error"
    ),
    false,
    "aborted detached runs must not convert tool parts to output-error",
  );
  assertEquals(
    result.finalizedFallbackMessage.parts.some((part) =>
      part.type === "dynamic-tool" && part.toolName === "bash" && part.state === "input-available"
    ),
    true,
    "the unfinished tool call must still be present in the fallback message",
  );
});

Deno.test("buildDetachedFallbackMessageState uses the captured message id for detached fallback messages", () => {
  const result = buildDetachedFallbackMessageState({
    capturedMessageId: "captured-1",
    finalStep: { text: "Detached done" },
    isAborted: false,
    incompleteToolCallsPartErrorText: "tool error",
  });

  assertEquals(result.finalizedFallbackMessage, {
    id: "captured-1",
    role: "assistant",
    parts: [{ type: "text", text: "Detached done" }],
  });
  assertEquals(result.hasIncompleteFallbackToolParts, false);
});

Deno.test("buildFinalizedMessageFallbackChunks builds finalized fallback text chunks for empty persisted messages", () => {
  const result = buildFinalizedMessageFallbackChunks({
    isAborted: false,
    persistedMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [],
    },
    sanitizedFinalizedMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "Done" }],
    },
    finalStep: { text: "Done" },
    mirroredToolChunkState: createMirroredToolChunkState(),
    capturedMessageId: null,
    hasIncompleteFinalizedToolParts: false,
  });

  assertEquals(result, [
    { type: "text-start", id: "assistant-1" },
    { type: "text-delta", id: "assistant-1", delta: "Done" },
    { type: "text-end", id: "assistant-1" },
  ]);
});

Deno.test("buildFinalizedMessageFallbackChunks preserves ordered text without duplicating mirrored tools", () => {
  const mirroredToolChunkState = createMirroredToolChunkState();
  mirroredToolChunkState.startedToolCallIds.add("call-1");
  mirroredToolChunkState.inputAvailableToolCallIds.add("call-1");
  mirroredToolChunkState.outputAvailableToolCallIds.add("call-1");

  const finalStep = {
    response: {
      messages: [{
        role: "assistant",
        content: [
          { type: "text", text: "Checking now." },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "form_input",
            input: { title: "Continue?" },
          },
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "form_input",
            output: { submitted: true },
          },
        ],
      }],
    },
  };

  const result = buildFinalizedMessageFallbackChunks({
    isAborted: false,
    persistedMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "data-veryfront.runtime_context", data: {} }],
    },
    sanitizedFinalizedMessage: {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "data-veryfront.runtime_context", data: {} },
        { type: "text", text: "Checking now." },
        {
          type: "dynamic-tool",
          toolName: "form_input",
          toolCallId: "call-1",
          input: { title: "Continue?" },
          state: "output-available",
          output: { submitted: true },
        },
      ],
    },
    finalStep,
    mirroredToolChunkState,
    capturedMessageId: null,
    hasIncompleteFinalizedToolParts: false,
  });

  assertEquals(result, [
    { type: "text-start", id: "assistant-1" },
    { type: "text-delta", id: "assistant-1", delta: "Checking now." },
    { type: "text-end", id: "assistant-1" },
  ]);
});

Deno.test("buildDetachedFallbackChunks omits detached fallback text chunks when durable output is already mirrored", () => {
  const result = buildDetachedFallbackChunks({
    fallbackParts: [{ type: "text", text: "Done" }],
    finalStep: { text: "Done" },
    mirroredToolChunkState: createMirroredToolChunkState(),
    mirroredDurableOutput: true,
    capturedMessageId: "captured-1",
    hasIncompleteFallbackToolParts: false,
  });

  assertEquals(result, []);
});

Deno.test("finalized tool input adopts matching final-step output without duplicate replay input", () => {
  const finalStep = {
    toolCalls: [{ toolCallId: "c", toolName: "bash", input: { command: "x" } }],
    toolResults: [{ toolCallId: "c", toolName: "bash", output: "ok" }],
  };
  const state = buildFinalizedMessageState({
    responseMessage: {
      id: "m",
      role: "assistant",
      parts: [{
        type: "tool-bash",
        toolCallId: "c",
        input: { command: "x" },
        state: "input-available",
      }],
    },
    isAborted: false,
    finalStep,
    incompleteToolCallsPartErrorText: "tool error",
  });
  assertEquals(state.sanitizedFinalizedMessage.parts, [{
    type: "tool-bash",
    toolCallId: "c",
    input: { command: "x" },
    state: "output-available",
    output: "ok",
  }]);
  assertEquals(state.hasIncompleteFinalizedToolParts, false);
  const mirrored = createMirroredToolChunkState();
  mirrored.startedToolCallIds.add("c");
  mirrored.inputAvailableToolCallIds.add("c");
  assertEquals(
    buildFinalizedMessageFallbackChunks({
      isAborted: false,
      ...state,
      finalStep,
      mirroredToolChunkState: mirrored,
      capturedMessageId: "m",
    }),
    [{ type: "tool-output-available", toolCallId: "c", output: "ok" }],
  );
});

Deno.test("partially streamed tool input recovers complete arguments in terminal and replay", () => {
  const finalStep = {
    toolCalls: [{ toolCallId: "c", toolName: "bash", input: { command: "x" } }],
    toolResults: [{ toolCallId: "c", toolName: "bash", output: "ok" }],
  };
  const state = buildFinalizedMessageState({
    responseMessage: {
      id: "m",
      role: "assistant",
      parts: [{
        type: "tool-bash",
        toolCallId: "c",
        input: { command: "partial" },
        state: "input-streaming",
      }],
    },
    isAborted: false,
    finalStep,
    incompleteToolCallsPartErrorText: "tool error",
  });
  assertEquals(state.sanitizedFinalizedMessage.parts, [{
    type: "tool-bash",
    toolCallId: "c",
    input: { command: "x" },
    state: "output-available",
    output: "ok",
  }]);
  assertEquals(state.hasIncompleteFinalizedToolParts, false);
  const mirrored = createMirroredToolChunkState();
  mirrored.startedToolCallIds.add("c");
  assertEquals(
    buildFinalizedMessageFallbackChunks({
      isAborted: false,
      ...state,
      finalStep,
      mirroredToolChunkState: mirrored,
      capturedMessageId: "m",
    }),
    [{ type: "tool-input-available", toolCallId: "c", toolName: "bash", input: { command: "x" } }, {
      type: "tool-output-available",
      toolCallId: "c",
      output: "ok",
    }],
  );
});

Deno.test("partial text suffix precedes its following final-step tool in terminal and replay", () => {
  const finalStep = {
    response: {
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: "Hello world" }, {
          type: "tool-call",
          toolCallId: "c",
          toolName: "bash",
          input: { command: "x" },
        }, { type: "tool-result", toolCallId: "c", toolName: "bash", output: "ok" }],
      }],
    },
  };
  const state = buildFinalizedMessageState({
    responseMessage: { id: "m", role: "assistant", parts: [{ type: "text", text: "Hello" }] },
    isAborted: false,
    finalStep,
    incompleteToolCallsPartErrorText: "tool error",
  });
  assertEquals(state.sanitizedFinalizedMessage.parts.map((part) => part.type), [
    "text",
    "text",
    "dynamic-tool",
  ]);
  assertEquals(state.sanitizedFinalizedMessage.parts[1], { type: "text", text: "world" });
  const repeated = buildFinalizedMessageState({
    responseMessage: state.sanitizedFinalizedMessage,
    isAborted: false,
    finalStep,
    incompleteToolCallsPartErrorText: "tool error",
  });
  assertEquals(repeated.sanitizedFinalizedMessage, state.sanitizedFinalizedMessage);
  const chunks = buildFinalizedMessageFallbackChunks({
    isAborted: false,
    ...state,
    finalStep,
    mirroredToolChunkState: createMirroredToolChunkState(),
    capturedMessageId: "m",
  });
  assertEquals(chunks.map((chunk) => chunk.type), [
    "text-start",
    "text-delta",
    "text-end",
    "tool-input-start",
    "tool-input-available",
    "tool-output-available",
  ]);
});

Deno.test("final-step tool completion preserves terminal refusal and aborted input", () => {
  const finalStep = { toolResults: [{ toolCallId: "c", toolName: "bash", output: "ok" }] };
  for (const isAborted of [true, false]) {
    const part = isAborted
      ? {
        type: "tool-bash" as const,
        toolCallId: "c",
        input: { command: "x" },
        state: "input-available" as const,
      }
      : {
        type: "tool-bash" as const,
        toolCallId: "c",
        input: { command: "x" },
        state: "output-error" as const,
        errorText: "denied",
      };
    const state = buildFinalizedMessageState({
      responseMessage: { id: "m", role: "assistant", parts: [part] },
      isAborted,
      finalStep,
      incompleteToolCallsPartErrorText: "tool error",
    });
    assertEquals(
      state.sanitizedFinalizedMessage.parts,
      isAborted ? [{ ...part, state: "output-error", errorText: "Stopped by user" }] : [part],
    );
  }
});

Deno.test("reasoning normalization retains the original signed part without duplicate replay", () => {
  const original = { type: "reasoning" as const, text: " Thinking ", signature: "sig" };
  const finalStep = { response: { messages: [{ role: "assistant", content: [original] }] } };
  const state = buildFinalizedMessageState({
    responseMessage: { id: "m", role: "assistant", parts: [original] },
    isAborted: false,
    finalStep,
    incompleteToolCallsPartErrorText: "tool error",
  });
  assertEquals(state.sanitizedFinalizedMessage.parts, [original]);
  assertEquals(
    buildFinalizedMessageFallbackChunks({
      isAborted: false,
      ...state,
      finalStep,
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "m",
    }),
    [],
  );
});

Deno.test("recovered reasoning preserves the persisted prefix and appends missing blocks", () => {
  const first = { type: "reasoning" as const, text: "First", signature: "first" };
  const second = { type: "reasoning" as const, text: "Second", signature: "second" };
  const text = { type: "text" as const, text: "Done" };
  for (const parts of [[text], [second, text]]) {
    const finalStep = {
      response: { messages: [{ role: "assistant", content: [first, second, text] }] },
    };
    const state = buildFinalizedMessageState({
      responseMessage: { id: "m", role: "assistant", parts },
      isAborted: false,
      finalStep,
      incompleteToolCallsPartErrorText: "tool error",
    });
    assertEquals(state.sanitizedFinalizedMessage.parts, [
      ...parts,
      first,
      ...(parts.includes(second) ? [] : [second]),
    ]);
    const repeated = buildFinalizedMessageState({
      responseMessage: state.sanitizedFinalizedMessage,
      isAborted: false,
      finalStep,
      incompleteToolCallsPartErrorText: "tool error",
    });
    assertEquals(repeated.sanitizedFinalizedMessage, state.sanitizedFinalizedMessage);
  }
});

Deno.test("fully streamed tool and text retain both original orders without fallback replay", () => {
  const tool = {
    type: "tool-bash" as const,
    toolCallId: "c",
    input: { command: "x" },
    state: "output-available" as const,
    output: "ok",
  };
  const text = { type: "text" as const, text: "Done" };
  const toolContent = [
    { type: "tool-call", toolCallId: "c", toolName: "bash", input: tool.input },
    { type: "tool-result", toolCallId: "c", toolName: "bash", output: "ok" },
  ];
  for (const toolFirst of [true, false]) {
    const responseMessage = {
      id: "m",
      role: "assistant" as const,
      parts: toolFirst ? [tool, text] : [text, tool],
    };
    const content = toolFirst ? [...toolContent, text] : [text, ...toolContent];
    const finalStep = { response: { messages: [{ role: "assistant", content }] } };
    const state = buildFinalizedMessageState({
      responseMessage,
      isAborted: false,
      finalStep,
      incompleteToolCallsPartErrorText: "tool error",
    });
    assertEquals(state.sanitizedFinalizedMessage, responseMessage);
    const mirrored = createMirroredToolChunkState();
    mirrored.startedToolCallIds.add("c");
    mirrored.inputAvailableToolCallIds.add("c");
    mirrored.outputAvailableToolCallIds.add("c");
    assertEquals(
      buildFinalizedMessageFallbackChunks({
        isAborted: false,
        ...state,
        finalStep,
        mirroredToolChunkState: mirrored,
        capturedMessageId: "m",
      }),
      [],
    );
  }
});

Deno.test("buildFinalizedMessageState reconciles a partial later text block without duplicating its prefix", () => {
  const responseMessage = {
    id: "assistant-1",
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: "First answer." }, {
      type: "text" as const,
      text: "Sec",
    }],
  };
  const finalStep = {
    response: {
      messages: [{
        role: "assistant",
        content: [
          { type: "text", text: "First answer." },
          { type: "text", text: "Second answer." },
        ],
      }],
    },
  };
  const input = {
    responseMessage,
    finalStep,
    isAborted: false,
    incompleteToolCallsPartErrorText: "tool error",
  };
  const result = buildFinalizedMessageState(input);
  assertEquals(result.sanitizedFinalizedMessage.parts, [
    ...responseMessage.parts,
    { type: "text", text: "ond answer." },
  ]);
  assertEquals(result.sanitizedFinalizedMessage.parts.slice(0, 2), responseMessage.parts);
  assertEquals(
    buildFinalizedMessageState({ ...input, responseMessage: result.sanitizedFinalizedMessage })
      .sanitizedFinalizedMessage.parts,
    result.sanitizedFinalizedMessage.parts,
  );
  assertEquals(
    buildFinalizedMessageFallbackChunks({
      isAborted: false,
      persistedMessage: result.persistedMessage,
      sanitizedFinalizedMessage: result.sanitizedFinalizedMessage,
      finalStep,
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-1",
      hasIncompleteFinalizedToolParts: false,
    }),
    [
      { type: "text-start", id: "assistant-1" },
      { type: "text-delta", id: "assistant-1", delta: "ond answer." },
      { type: "text-end", id: "assistant-1" },
    ],
  );
});

Deno.test("finalized text alignment skips empty persisted text shells", () => {
  const responseMessage = {
    id: "m",
    role: "assistant" as const,
    parts: [
      { type: "text" as const, text: "" },
      { type: "text" as const, text: "First answer." },
      { type: "text" as const, text: "Sec" },
    ],
  };
  const state = buildFinalizedMessageState({
    responseMessage,
    isAborted: false,
    finalStep: {
      response: {
        messages: [{
          role: "assistant",
          content: [
            { type: "text", text: "First answer." },
            { type: "text", text: "Second answer." },
          ],
        }],
      },
    },
    incompleteToolCallsPartErrorText: "tool error",
  });
  assertEquals(state.sanitizedFinalizedMessage.parts, [...responseMessage.parts, {
    type: "text",
    text: "ond answer.",
  }]);
});

for (
  const [text, boundary] of [["Done", true], ["Do", true], ["Done", false], ["Do", false]] as const
) {
  Deno.test(`final-step text alignment ignores earlier-step text (${text}, boundary ${boundary})`, () => {
    const responseMessage = {
      id: "m",
      role: "assistant" as const,
      parts: [
        { type: "text" as const, text: "I'll check" },
        ...(boundary ? [{ type: "step-start" as const }] : []),
        { type: "text" as const, text },
      ],
    };
    const finalStep = { text: "Done" };
    const state = buildFinalizedMessageState({
      responseMessage,
      finalStep,
      isAborted: false,
      incompleteToolCallsPartErrorText: "tool error",
    });
    const suffix = text === "Do" ? [{ type: "text" as const, text: "ne" }] : [];
    assertEquals(state.sanitizedFinalizedMessage.parts, [...responseMessage.parts, ...suffix]);
    assertEquals(
      buildFinalizedMessageState({
        responseMessage: state.sanitizedFinalizedMessage,
        finalStep,
        isAborted: false,
        incompleteToolCallsPartErrorText: "tool error",
      })
        .sanitizedFinalizedMessage.parts,
      state.sanitizedFinalizedMessage.parts,
    );
    assertEquals(
      buildFinalizedMessageFallbackChunks({
        isAborted: false,
        ...state,
        finalStep,
        mirroredToolChunkState: createMirroredToolChunkState(),
        capturedMessageId: "m",
      }),
      text === "Do"
        ? [{ type: "text-start", id: "m" }, { type: "text-delta", id: "m", delta: "ne" }, {
          type: "text-end",
          id: "m",
        }]
        : [],
    );
  });
}

Deno.test("final-step reasoning does not consume an identical earlier-step block", () => {
  const reasoning = { type: "reasoning" as const, text: "Thinking" };
  const responseMessage = {
    id: "m",
    role: "assistant" as const,
    parts: [reasoning, { type: "step-start" as const }],
  };
  const finalStep = { response: { messages: [{ role: "assistant", content: [reasoning] }] } };
  const state = buildFinalizedMessageState({
    responseMessage,
    finalStep,
    isAborted: false,
    incompleteToolCallsPartErrorText: "tool error",
  });
  assertEquals(state.sanitizedFinalizedMessage.parts, [...responseMessage.parts, reasoning]);
  assertEquals(
    buildFinalizedMessageState({
      responseMessage: state.sanitizedFinalizedMessage,
      finalStep,
      isAborted: false,
      incompleteToolCallsPartErrorText: "tool error",
    })
      .sanitizedFinalizedMessage.parts,
    state.sanitizedFinalizedMessage.parts,
  );
  assertEquals(
    buildFinalizedMessageFallbackChunks({
      isAborted: false,
      ...state,
      finalStep,
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "m",
    }),
    [
      { type: "reasoning-start", id: "m:reasoning" },
      { type: "reasoning-delta", id: "m:reasoning", delta: "Thinking" },
      { type: "reasoning-end", id: "m:reasoning" },
    ],
  );
});

for (const state of ["pending", "input-streaming", "input-available"] as const) {
  for (const ownership of [undefined, true, false]) {
    Deno.test(`resultless provider fallback respects ${state} call ownership ${ownership}`, () => {
      const part = {
        type: "tool-web_fetch" as const,
        toolCallId: "c",
        state,
        input: { accepted: true },
        ...(ownership === undefined ? {} : { providerExecuted: ownership }),
      };
      const result = buildFinalizedMessageState({
        responseMessage: { id: "m", role: "assistant", parts: [part] },
        isAborted: false,
        finalStep: {
          toolCalls: [{
            toolCallId: "c",
            toolName: "web_fetch",
            input: { recovered: true },
            providerExecuted: true,
          }],
        },
        incompleteToolCallsPartErrorText: "tool error",
      });
      assertEquals(result.hasIncompleteFinalizedToolParts, ownership === false);
      assertEquals(result.sanitizedFinalizedMessage.parts, [{
        ...part,
        ...(ownership === false ? { state: "output-error", errorText: "tool error" } : {
          state: "input-available",
          providerExecuted: true,
          input: state === "input-available" ? { accepted: true } : { recovered: true },
        }),
      }]);
    });
  }
}

Deno.test("missing earlier fallback text retains a later persisted block for reconciliation", () => {
  const responseMessage = {
    id: "m",
    role: "assistant" as const,
    parts: [{ type: "step-start" as const }, { type: "text" as const, text: "Second" }],
  };
  const finalStep = {
    response: {
      messages: [{
        role: "assistant",
        content: [
          { type: "text", text: "First" },
          { type: "text", text: "Second" },
        ],
      }],
    },
  };
  const input = {
    responseMessage,
    finalStep,
    isAborted: false,
    incompleteToolCallsPartErrorText: "tool error",
  };
  const state = buildFinalizedMessageState(input);
  assertEquals(state.sanitizedFinalizedMessage.parts, [...responseMessage.parts, {
    type: "text",
    text: "First",
  }]);
  assertEquals(
    buildFinalizedMessageState({ ...input, responseMessage: state.sanitizedFinalizedMessage })
      .sanitizedFinalizedMessage.parts,
    state.sanitizedFinalizedMessage.parts,
  );
  assertEquals(
    buildFinalizedMessageFallbackChunks({
      isAborted: false,
      ...state,
      finalStep,
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "m",
    }),
    [
      { type: "text-start", id: "m" },
      { type: "text-delta", id: "m", delta: "First" },
      { type: "text-end", id: "m" },
    ],
  );
});

Deno.test("partial later fallback remains idempotent around an appended earlier block", () => {
  const input = {
    responseMessage: {
      id: "m",
      role: "assistant" as const,
      parts: [{ type: "step-start" as const }, { type: "text" as const, text: "Sec" }],
    },
    finalStep: {
      response: {
        messages: [{
          role: "assistant",
          content: [
            { type: "text", text: "First" },
            { type: "text", text: "Second" },
          ],
        }],
      },
    },
    isAborted: false,
    incompleteToolCallsPartErrorText: "tool error",
  };
  const first = buildFinalizedMessageState(input).sanitizedFinalizedMessage;
  assertEquals(first.parts, [
    ...input.responseMessage.parts,
    { type: "text", text: "First" },
    { type: "text", text: "ond" },
  ]);
  assertEquals(
    buildFinalizedMessageState({ ...input, responseMessage: first }).sanitizedFinalizedMessage
      .parts,
    first.parts,
  );
});

Deno.test("an earlier partial occurrence retains a later exact-looking prefix", () => {
  const input = {
    responseMessage: {
      id: "m",
      role: "assistant" as const,
      parts: [
        { type: "step-start" as const },
        { type: "text" as const, text: "Do" },
        { type: "text" as const, text: "Done" },
      ],
    },
    finalStep: {
      response: {
        messages: [{
          role: "assistant",
          content: [{ type: "text", text: "Done" }, { type: "text", text: "Done later" }],
        }],
      },
    },
    isAborted: false,
    incompleteToolCallsPartErrorText: "tool error",
  };
  const once = buildFinalizedMessageState(input).sanitizedFinalizedMessage;
  assertEquals(once.parts, [
    ...input.responseMessage.parts,
    { type: "text", text: "ne" },
    { type: "text", text: "later" },
  ]);
  assertEquals(
    buildFinalizedMessageState({ ...input, responseMessage: once }).sanitizedFinalizedMessage.parts,
    once.parts,
  );
});

Deno.test("three repeated-prefix occurrences recover only their individual missing suffixes", () => {
  for (const expected of [["Done", "Done later", "Done later again"], ["Done", "Done", "Done"]]) {
    const choices = expected.map((text) => [...new Set(["Do", "Done", text])]);
    for (const first of choices[0]!) {
      for (const second of choices[1]!) {
        for (const third of choices[2]!) {
          const texts = [first, second, third];
          const input = {
            responseMessage: {
              id: "m",
              role: "assistant" as const,
              parts: [
                { type: "step-start" as const },
                ...texts.map((text) => ({ type: "text" as const, text })),
              ],
            },
            finalStep: {
              response: {
                messages: [{
                  role: "assistant",
                  content: expected.map((text) => ({ type: "text", text })),
                }],
              },
            },
            isAborted: false,
            incompleteToolCallsPartErrorText: "tool error",
          };
          const once = buildFinalizedMessageState(input).sanitizedFinalizedMessage;
          const missing = expected.map((text, index) => text.slice(texts[index]!.length).trim())
            .filter(Boolean).map((text) => ({ type: "text" as const, text }));
          assertEquals(
            once.parts,
            [...input.responseMessage.parts, ...missing],
            JSON.stringify({ expected, texts }),
          );
          assertEquals(
            buildFinalizedMessageState({ ...input, responseMessage: once })
              .sanitizedFinalizedMessage.parts,
            once.parts,
            JSON.stringify({ expected, texts }),
          );
        }
      }
    }
  }
});

Deno.test("adversarial repeated fragments fail within the shared reconciliation search budget", () => {
  const responseMessage = {
    id: "m",
    role: "assistant" as const,
    parts: [
      { type: "step-start" as const },
      ...Array.from({ length: 20 }, () => ({ type: "text" as const, text: "a" })),
    ],
  };
  const before = structuredClone(responseMessage);
  const error = assertThrows(
    () =>
      buildFinalizedMessageState({
        responseMessage,
        finalStep: {
          response: {
            messages: [{
              role: "assistant",
              content: [
                { type: "text", text: "a".repeat(20) },
                { type: "text", text: "a".repeat(20) },
              ],
            }],
          },
        },
        isAborted: false,
        incompleteToolCallsPartErrorText: "tool error",
      }),
    Error,
    "exceeded its search budget",
  );
  assertEquals(error.name, "FallbackTextReconciliationLimitError");
  assertEquals(responseMessage, before);
});

for (const count of [129, 5000, 128]) {
  Deno.test(`single fallback text rejects ${count} persisted fragments within reconciliation bounds`, () => {
    const responseMessage = {
      id: "m",
      role: "assistant" as const,
      parts: Array.from({ length: count }, () => ({ type: "text" as const, text: "a" })),
    };
    const before = structuredClone(responseMessage);
    const error = assertThrows(
      () =>
        buildFinalizedMessageState({
          responseMessage,
          finalStep: { text: count === 5000 ? "a" : "a".repeat(count) },
          isAborted: false,
          incompleteToolCallsPartErrorText: "tool error",
        }),
      Error,
      "exceeded its search budget",
    );
    assertEquals(error.name, "FallbackTextReconciliationLimitError");
    assertEquals(responseMessage, before);
  });
}

Deno.test("empty persisted text recovers many provider blocks without occurrence search", () => {
  const content = Array.from(
    { length: 100 },
    (_, index) => ({ type: "text" as const, text: `block ${index}` }),
  );
  const input = {
    responseMessage: {
      id: "m",
      role: "assistant" as const,
      parts: [{ type: "step-start" as const }],
    },
    finalStep: { response: { messages: [{ role: "assistant", content }] } },
    isAborted: false,
    incompleteToolCallsPartErrorText: "tool error",
  };
  const result = buildFinalizedMessageState(input).sanitizedFinalizedMessage;
  assertEquals(result.parts, [...input.responseMessage.parts, ...content]);
  assertEquals(
    buildFinalizedMessageState({ ...input, responseMessage: result }).sanitizedFinalizedMessage
      .parts,
    result.parts,
  );
});

for (const [persistedCount, fallbackCount] of [[1, 3000], [5000, 2]] as const) {
  Deno.test(`reconciliation rejects structural overload (${persistedCount}, ${fallbackCount})`, () => {
    const error = assertThrows(
      () =>
        buildFinalizedMessageState({
          responseMessage: {
            id: "m",
            role: "assistant",
            parts: [
              { type: "step-start" },
              ...Array.from(
                { length: persistedCount },
                () => ({ type: "text" as const, text: "a" }),
              ),
            ],
          },
          finalStep: {
            response: {
              messages: [{
                role: "assistant",
                content: Array.from({ length: fallbackCount }, () => ({ type: "text", text: "a" })),
              }],
            },
          },
          isAborted: false,
          incompleteToolCallsPartErrorText: "tool error",
        }),
      Error,
      "exceeded its search budget",
    );
    assertEquals(error.name, "FallbackTextReconciliationLimitError");
  });
}

Deno.test("fallback text occurrence assignment is idempotent across partial and exact permutations", () => {
  for (const expected of [["First", "Second"], ["Done", "Done later"]]) {
    for (const first of ["", expected[0]!.slice(0, 2), expected[0]!]) {
      for (const second of ["", expected[1]!.slice(0, 2), expected[1]!]) {
        for (const reversed of [false, true]) {
          const texts = [first, second].filter(Boolean);
          if (reversed) texts.reverse();
          const input = {
            responseMessage: {
              id: "m",
              role: "assistant" as const,
              parts: [
                { type: "step-start" as const },
                ...texts.map((text) => ({ type: "text" as const, text })),
              ],
            },
            finalStep: {
              response: {
                messages: [{
                  role: "assistant",
                  content: expected.map((text) => ({ type: "text", text })),
                }],
              },
            },
            isAborted: false,
            incompleteToolCallsPartErrorText: "tool error",
          };
          const once = buildFinalizedMessageState(input).sanitizedFinalizedMessage;
          const twice = buildFinalizedMessageState({ ...input, responseMessage: once })
            .sanitizedFinalizedMessage;
          assertEquals(twice.parts, once.parts, JSON.stringify({ expected, texts }));
          if (expected[0] === "First" && first === "Fi" && second === "Second" && !reversed) {
            assertEquals(once.parts, [...input.responseMessage.parts, {
              type: "text",
              text: "rst",
            }]);
          }
        }
      }
    }
  }
});

for (const current of ["Done", "Don"]) {
  Deno.test(`without step boundaries the longest matching text wins (${current})`, () => {
    const responseMessage = {
      id: "m",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Do" }, { type: "text" as const, text: current }],
    };
    const finalStep = { text: "Done" };
    const input = {
      responseMessage,
      finalStep,
      isAborted: false,
      incompleteToolCallsPartErrorText: "tool error",
    };
    const state = buildFinalizedMessageState(input);
    assertEquals(state.sanitizedFinalizedMessage.parts, [
      ...responseMessage.parts,
      ...(current === "Don" ? [{ type: "text" as const, text: "e" }] : []),
    ]);
    assertEquals(
      buildFinalizedMessageState({ ...input, responseMessage: state.sanitizedFinalizedMessage })
        .sanitizedFinalizedMessage.parts,
      state.sanitizedFinalizedMessage.parts,
    );
    assertEquals(
      buildFinalizedMessageFallbackChunks({
        ...state,
        finalStep,
        isAborted: false,
        mirroredToolChunkState: createMirroredToolChunkState(),
        capturedMessageId: "m",
      }),
      current === "Done" ? [] : [
        { type: "text-start", id: "m" },
        { type: "text-delta", id: "m", delta: "e" },
        { type: "text-end", id: "m" },
      ],
    );
  });
}

Deno.test("finalized text recovers the latest partial repeated block", () => {
  const responseMessage = {
    id: "assistant-1",
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: "Done" }, { type: "text" as const, text: "Do" }],
  };
  const input = {
    responseMessage,
    finalStep: { text: "Done" },
    isAborted: false,
    incompleteToolCallsPartErrorText: "tool error",
  };
  const state = buildFinalizedMessageState(input);
  assertEquals(state.sanitizedFinalizedMessage.parts, [
    ...responseMessage.parts,
    { type: "text", text: "ne" },
  ]);
  assertEquals(
    buildFinalizedMessageState({ ...input, responseMessage: state.sanitizedFinalizedMessage })
      .sanitizedFinalizedMessage.parts,
    state.sanitizedFinalizedMessage.parts,
  );
  assertEquals(
    buildFinalizedMessageFallbackChunks({
      ...state,
      isAborted: false,
      finalStep: input.finalStep,
      mirroredToolChunkState: createMirroredToolChunkState(),
      capturedMessageId: "assistant-1",
    }),
    [
      { type: "text-start", id: "assistant-1" },
      { type: "text-delta", id: "assistant-1", delta: "ne" },
      { type: "text-end", id: "assistant-1" },
    ],
  );
});

Deno.test("review recovery emits a reconciled tool result before later fallback text", () => {
  const tool = {
    type: "tool-bash" as const,
    toolCallId: "c",
    state: "input-available" as const,
    input: { command: "pwd" },
  };
  const finalStep = {
    response: {
      messages: [{
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c", toolName: "bash", input: tool.input },
          { type: "tool-result", toolCallId: "c", toolName: "bash", output: "workspace" },
          { type: "text", text: "Done" },
        ],
      }],
    },
  };
  const state = buildFinalizedMessageState({
    responseMessage: { id: "m", role: "assistant", parts: [tool] },
    isAborted: false,
    finalStep,
    incompleteToolCallsPartErrorText: "tool error",
  });
  const mirrored = createMirroredToolChunkState();
  recordMirroredToolChunkState(mirrored, {
    type: "tool-input-available",
    toolCallId: "c",
    toolName: "bash",
    input: tool.input,
  });
  const chunks = buildFinalizedMessageFallbackChunks({
    ...state,
    finalStep,
    isAborted: false,
    mirroredToolChunkState: mirrored,
    capturedMessageId: "m",
  });
  const encoder = new ConversationRunEventEncoder();
  const events = chunks.flatMap((chunk) => {
    if (chunk.type === "finish") throw new Error("Unexpected finish in recovered content");
    return encoder.encode(chunk);
  });
  assertEquals(
    events.filter((event) => ["TOOL_CALL_RESULT", "TEXT_MESSAGE_CONTENT"].includes(event.type)).map(
      (event) => event.type,
    ),
    ["TOOL_CALL_RESULT", "TEXT_MESSAGE_CONTENT"],
  );
});

Deno.test("review repeated fallback text consumes persisted matches in order", () => {
  const responseMessage = {
    id: "m",
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: "Done" }, { type: "text" as const, text: "Do" }],
  };
  const finalStep = {
    response: {
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: "Done" }, { type: "text", text: "Done later" }],
      }],
    },
  };
  const state = buildFinalizedMessageState({
    responseMessage,
    finalStep,
    isAborted: false,
    incompleteToolCallsPartErrorText: "tool error",
  });
  assertEquals(state.sanitizedFinalizedMessage.parts, [...responseMessage.parts, {
    type: "text",
    text: "ne later",
  }]);
  assertEquals(
    buildFinalizedMessageState({
      responseMessage: state.sanitizedFinalizedMessage,
      finalStep,
      isAborted: false,
      incompleteToolCallsPartErrorText: "tool error",
    }).sanitizedFinalizedMessage.parts,
    state.sanitizedFinalizedMessage.parts,
  );
  const chunks = buildFinalizedMessageFallbackChunks({
    ...state,
    finalStep,
    isAborted: false,
    mirroredToolChunkState: createMirroredToolChunkState(),
    capturedMessageId: "m",
  });
  assertEquals(chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.delta), [
    "ne later",
  ]);
});

Deno.test("review recovered reasoning uses IDs distinct from actual mirrored blocks", () => {
  const first = { type: "reasoning" as const, text: "First", signature: "private-first" };
  const second = { type: "reasoning" as const, text: "Second", signature: "private-second" };
  const finalStep = { response: { messages: [{ role: "assistant", content: [first, second] }] } };
  const state = buildFinalizedMessageState({
    responseMessage: { id: "m", role: "assistant", parts: [first] },
    finalStep,
    isAborted: false,
    incompleteToolCallsPartErrorText: "tool error",
  });
  const mirrored = createMirroredToolChunkState();
  const prefix = [
    { type: "reasoning-start" as const, id: "m:reasoning" },
    { type: "reasoning-delta" as const, id: "m:reasoning", delta: first.text },
    { type: "reasoning-end" as const, id: "m:reasoning", signature: first.signature },
  ];
  for (const chunk of prefix) recordMirroredToolChunkState(mirrored, chunk);
  recordMirroredToolChunkState(mirrored, {
    type: "reasoning-start",
    id: "m:reasoning:recovered:2",
  });
  const chunks = buildFinalizedMessageFallbackChunks({
    ...state,
    finalStep,
    isAborted: false,
    mirroredToolChunkState: mirrored,
    capturedMessageId: "m",
  });
  const encoder = new ConversationRunEventEncoder();
  const events = [...prefix, ...chunks].flatMap((chunk) => {
    if (chunk.type === "finish") throw new Error("Unexpected finish in recovered content");
    return encoder.encode(chunk);
  });
  const ids = events.filter((event) => event.type === "REASONING_MESSAGE_START").map((event) =>
    event.contentId
  );
  assertEquals(ids.length, 2);
  assertEquals(new Set(ids).size, 2);
  assertEquals(ids.includes("m:reasoning:recovered:2"), false);
  const replay = readConversationRunLifecycleFrames({ streamProtocolVersion: 1, events });
  assertEquals(replay.status, "ok");
  if (replay.status === "ok") {
    assertEquals(JSON.stringify(replay.frames).includes("private-"), false);
  }
});

Deno.test("review fallback text uses recovery position rather than an earlier identical suffix", () => {
  const tool = {
    type: "tool-bash" as const,
    toolCallId: "c",
    state: "input-available" as const,
    input: { command: "pwd" },
  };
  const finalStep = {
    response: {
      messages: [{
        role: "assistant",
        content: [
          { type: "text", text: "Hello world" },
          { type: "tool-call", toolCallId: "c", toolName: "bash", input: tool.input },
          { type: "tool-result", toolCallId: "c", toolName: "bash", output: "workspace" },
          { type: "text", text: "world" },
        ],
      }],
    },
  };
  const state = buildFinalizedMessageState({
    responseMessage: {
      id: "m",
      role: "assistant",
      parts: [{ type: "text", text: "Hello world" }, tool],
    },
    isAborted: false,
    finalStep,
    incompleteToolCallsPartErrorText: "tool error",
  });
  const mirrored = createMirroredToolChunkState();
  recordMirroredToolChunkState(mirrored, {
    type: "tool-input-available",
    toolCallId: "c",
    toolName: "bash",
    input: tool.input,
  });
  const chunks = buildFinalizedMessageFallbackChunks({
    ...state,
    finalStep,
    isAborted: false,
    mirroredToolChunkState: mirrored,
    capturedMessageId: "m",
  });
  assertEquals(chunks.map((chunk) => chunk.type), [
    "tool-output-available",
    "text-start",
    "text-delta",
    "text-end",
  ]);
});

Deno.test("completed tool output recovers final-step provider ownership without replacing bytes", () => {
  const part = {
    type: "tool-web_fetch" as const,
    toolCallId: "completed",
    state: "output-available" as const,
    input: { url: "https://example.test" },
    output: { actual: "streamed result" },
  };
  const finalStep = {
    toolCalls: [{
      toolCallId: "completed",
      toolName: "web_fetch",
      input: {},
      providerExecuted: true,
    }],
  };
  const result = buildFinalizedMessageState({
    responseMessage: { id: "m", role: "assistant", parts: [part] },
    isAborted: false,
    finalStep,
    incompleteToolCallsPartErrorText: "tool error",
  });
  assertEquals(result.sanitizedFinalizedMessage.parts, [{ ...part, providerExecuted: true }]);
});

Deno.test("completed tool output preserves explicit local ownership", () => {
  const part = {
    type: "tool-web_fetch" as const,
    toolCallId: "completed",
    state: "output-available" as const,
    input: {},
    output: "actual result",
    providerExecuted: false,
  };
  const result = buildFinalizedMessageState({
    responseMessage: { id: "m", role: "assistant", parts: [part] },
    isAborted: false,
    finalStep: {
      toolCalls: [{
        toolCallId: "completed",
        toolName: "web_fetch",
        input: {},
        providerExecuted: true,
      }],
    },
    incompleteToolCallsPartErrorText: "tool error",
  });
  assertEquals(result.sanitizedFinalizedMessage.parts, [part]);
});

Deno.test("completed mirrored tool ownership recovery reaches durable version1 replay once", () => {
  const chunks = [
    { type: "tool-input-start" as const, toolCallId: "completed", toolName: "web_fetch" },
    {
      type: "tool-input-available" as const,
      toolCallId: "completed",
      toolName: "web_fetch",
      input: {},
    },
    {
      type: "tool-output-available" as const,
      toolCallId: "completed",
      output: { actual: "streamed result" },
    },
  ];
  const mirroredToolChunkState = createMirroredToolChunkState();
  const encoder = new ConversationRunEventEncoder();
  encoder.encode({ type: "start", messageId: "m" });
  const events = chunks.flatMap((chunk) => {
    recordMirroredToolChunkState(mirroredToolChunkState, chunk);
    return encoder.encode(chunk);
  });
  const finalStep = {
    toolCalls: [{
      toolCallId: "completed",
      toolName: "web_fetch",
      input: {},
      providerExecuted: true,
    }],
  };
  const state = buildFinalizedMessageState({
    responseMessage: {
      id: "m",
      role: "assistant",
      parts: [{
        type: "tool-web_fetch",
        toolCallId: "completed",
        state: "output-available",
        input: {},
        output: { actual: "streamed result" },
      }],
    },
    isAborted: false,
    finalStep,
    incompleteToolCallsPartErrorText: "tool error",
  });
  const fallback = buildFinalizedMessageFallbackChunks({
    ...state,
    finalStep,
    mirroredToolChunkState,
    isAborted: false,
    capturedMessageId: "m",
  });
  assertEquals(fallback, []);
  const corrections = buildToolResultOwnershipCorrectionEvents({
    persistedMessage: state.persistedMessage,
    finalizedMessage: state.sanitizedFinalizedMessage,
    mirroredToolChunkState,
    isAborted: false,
  });
  assertEquals(corrections.length, 1);
  assertEquals(corrections[0], {
    type: "CUSTOM",
    name: "veryfront.tool_result_ownership",
    value: {
      schemaVersion: 1,
      toolCallId: "completed",
      toolName: "web_fetch",
      parentMessageId: "m",
      providerExecuted: true,
    },
  });
  events.push(...corrections);
  assertEquals(events.filter((event) => event.type === "TOOL_CALL_RESULT").length, 1);
  assertEquals(
    buildToolResultOwnershipCorrectionEvents({
      persistedMessage: state.persistedMessage,
      finalizedMessage: state.sanitizedFinalizedMessage,
      mirroredToolChunkState,
      isAborted: true,
    }),
    [],
  );
  const replay = readConversationRunLifecycleFrames({ streamProtocolVersion: 1, events });
  assertEquals(replay.status, "ok");
  if (replay.status === "ok") {
    const semantic = replay.frames.filter((frame) => frame.class === "semantic").map((frame) =>
      frame.event
    );
    assertEquals(semantic.filter((event) => event.type === "provider_tool_result").length, 1);
    assertEquals(
      semantic.some((event) => event.type === "custom" && event.name === "legacy-tool-result"),
      false,
    );
  }
});

Deno.test("ownership metadata requires missing ownership and a completed mirrored occurrence", () => {
  for (const ownership of [undefined, true, false]) {
    for (const isAborted of [false, true]) {
      for (const mirrored of [false, true]) {
        const part = {
          type: "tool-web_fetch" as const,
          toolCallId: "c",
          state: "output-available" as const,
          input: { private: "input" },
          output: { private: "output" },
          ...(ownership === undefined ? {} : { providerExecuted: ownership }),
        };
        const state = buildFinalizedMessageState({
          responseMessage: { id: "m", role: "assistant", parts: [part] },
          isAborted,
          finalStep: {
            toolCalls: [{
              toolCallId: "c",
              toolName: "web_fetch",
              input: {},
              providerExecuted: true,
            }],
          },
          incompleteToolCallsPartErrorText: "tool error",
        });
        const mirror = createMirroredToolChunkState();
        if (mirrored) mirror.outputAvailableToolCallIds.add("c");
        const corrections = buildToolResultOwnershipCorrectionEvents({
          persistedMessage: state.persistedMessage,
          finalizedMessage: state.sanitizedFinalizedMessage,
          mirroredToolChunkState: mirror,
          isAborted,
        });
        assertEquals(corrections.length, ownership === undefined && !isAborted && mirrored ? 1 : 0);
        assertEquals(JSON.stringify(corrections).includes("private"), false);
        mirror.ownershipCorrectedToolCallIds = new Set(["c"]);
        assertEquals(
          buildToolResultOwnershipCorrectionEvents({
            persistedMessage: state.persistedMessage,
            finalizedMessage: state.sanitizedFinalizedMessage,
            mirroredToolChunkState: mirror,
            isAborted,
          }),
          [],
        );
      }
    }
  }
});

Deno.test("completed ownership requires the same final-step tool name", () => {
  const part = {
    type: "tool-web_fetch" as const,
    toolCallId: "c",
    state: "output-available" as const,
    input: {},
    output: "actual result",
  };
  const state = buildFinalizedMessageState({
    responseMessage: { id: "m", role: "assistant", parts: [part] },
    isAborted: false,
    finalStep: {
      toolCalls: [{
        toolCallId: "c",
        toolName: "different_tool",
        input: {},
        providerExecuted: true,
      }],
    },
    incompleteToolCallsPartErrorText: "tool error",
  });
  assertEquals(state.sanitizedFinalizedMessage.parts, [part]);
});
