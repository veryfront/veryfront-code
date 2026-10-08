import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "@std/assert";
import { createMirroredToolChunkState } from "../streaming/mirrored-tool-chunk-state.ts";
import {
  buildDetachedFallbackChunks,
  buildDetachedFallbackMessageState,
  buildFinalizedMessageFallbackChunks,
  buildFinalizedMessageState,
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
