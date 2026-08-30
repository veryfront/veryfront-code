import { assertEquals, assertInstanceOf, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import {
  AnthropicServerToolResultError,
  MAX_ANTHROPIC_RAW_ASSISTANT_METADATA_BYTES,
  MAX_ANTHROPIC_REPLAY_ASSISTANT_MESSAGES,
  parseAnthropicProviderToolUse,
  parseAnthropicServerToolResult,
  validateAnthropicRawAssistantMessages,
} from "./anthropic-native-content.ts";

async function runNoBrandEval(script: string): Promise<unknown> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["eval", "--config=deno.json", script],
    cwd: new URL("../../../", import.meta.url),
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = new TextDecoder().decode(output.stderr);
  assertEquals(output.code, 0, stderr);
  return JSON.parse(new TextDecoder().decode(output.stdout));
}

describe("Anthropic provider-native content normalization", () => {
  it("keeps the provider response cap separate from cumulative durable replay", () => {
    const messages = Array.from(
      { length: 7 },
      (_, index) => [{ type: "text", text: `step ${index}` }],
    );

    assertThrows(
      () => validateAnthropicRawAssistantMessages(messages),
      TypeError,
      "between 1 and 6 messages",
    );
    assertEquals(
      validateAnthropicRawAssistantMessages(
        messages,
        new Map(),
        MAX_ANTHROPIC_REPLAY_ASSISTANT_MESSAGES,
      ),
      messages,
    );
  });

  it("owns exact replay metadata and rejects executable object behavior", () => {
    const rawMessages = [[{
      type: "tool_use",
      id: "tool_lookup",
      name: "lookup",
      input: { query: "Veryfront" },
    }]];
    const snapshot = validateAnthropicRawAssistantMessages(rawMessages);
    rawMessages[0]![0]!.input.query = "mutated";
    assertEquals(snapshot, [[{
      type: "tool_use",
      id: "tool_lookup",
      name: "lookup",
      input: { query: "Veryfront" },
    }]]);

    let accessorReads = 0;
    const hostileInput = Object.defineProperty({}, "query", {
      enumerable: true,
      get() {
        accessorReads += 1;
        throw new Error("private metadata diagnostic");
      },
    });
    const accessorError = assertThrows(
      () =>
        validateAnthropicRawAssistantMessages([[{
          type: "tool_use",
          id: "tool_accessor",
          name: "lookup",
          input: hostileInput,
        }]]),
      TypeError,
      "Anthropic raw assistant metadata was not valid bounded JSON",
    );
    assertEquals(accessorReads, 0);
    assertEquals(accessorError.message.includes("private metadata diagnostic"), false);

    let serializationHookCalls = 0;
    assertThrows(
      () =>
        validateAnthropicRawAssistantMessages([[{
          type: "tool_use",
          id: "tool_to_json",
          name: "lookup",
          input: {
            query: "Veryfront",
            toJSON() {
              serializationHookCalls += 1;
              return { query: "changed" };
            },
          },
        }]]),
      TypeError,
      "Anthropic raw assistant metadata was not valid bounded JSON",
    );
    assertEquals(serializationHookCalls, 0);

    assertThrows(
      () =>
        validateAnthropicRawAssistantMessages([[{
          type: "text",
          text: "x".repeat(MAX_ANTHROPIC_RAW_ASSISTANT_METADATA_BYTES),
        }]]),
      TypeError,
      `Anthropic raw assistant metadata exceeded ${MAX_ANTHROPIC_RAW_ASSISTANT_METADATA_BYTES} UTF-8 bytes`,
    );
  });

  it("accepts plain raw assistant metadata without Proxy detection", async () => {
    const result = await runNoBrandEval(`
      Object.defineProperty(globalThis, "caches", {
        configurable: true,
        value: {},
      });
      Object.defineProperty(globalThis, "WebSocketPair", {
        configurable: true,
        value: function WebSocketPair() {},
      });

      const { canIdentifyProxyWithoutHooks } = await import(
        "./src/platform/compat/error-introspection.ts"
      );
      const { validateAnthropicRawAssistantMessages } = await import(
        "./extensions/ext-llm-anthropic/src/anthropic-native-content.ts"
      );

      console.log(JSON.stringify({
        canIdentifyProxyWithoutHooks,
        messages: validateAnthropicRawAssistantMessages([[
          {
            type: "thinking",
            thinking: "valid",
            signature: "sig_edge",
          },
          {
            type: "tool_use",
            id: "tool_edge",
            name: "lookup",
            input: { query: "Veryfront" },
          },
        ]]),
      }));
    `);
    assertEquals(result, {
      canIdentifyProxyWithoutHooks: false,
      messages: [[
        {
          type: "thinking",
          thinking: "valid",
          signature: "sig_edge",
        },
        {
          type: "tool_use",
          id: "tool_edge",
          name: "lookup",
          input: { query: "Veryfront" },
        },
      ]],
    });
  });

  it("keeps ordinary client tool_use blocks out of the provider-executed path", () => {
    assertEquals(
      parseAnthropicProviderToolUse({
        type: "tool_use",
        id: "tool_bash",
        name: "bash",
        input: { command: "pwd" },
      }),
      undefined,
    );
  });

  it("parses server and MCP tool uses with their actual names", () => {
    assertEquals(
      parseAnthropicProviderToolUse({
        type: "server_tool_use",
        id: "srvtool_code",
        name: "code_execution",
        input: { code: "1 + 1" },
        caller: { type: "direct" },
      }),
      {
        blockType: "server_tool_use",
        toolCallId: "srvtool_code",
        toolName: "code_execution",
        input: { code: "1 + 1" },
      },
    );
    assertEquals(
      parseAnthropicProviderToolUse({
        type: "mcp_tool_use",
        id: "mcptool_echo",
        name: "echo",
        server_name: "example-mcp",
        input: { value: "hello" },
      }),
      {
        blockType: "mcp_tool_use",
        toolCallId: "mcptool_echo",
        toolName: "echo",
        serverName: "example-mcp",
        input: { value: "hello" },
      },
    );
  });

  it("normalizes generic, encrypted, and bash code-execution results", () => {
    const cases = [{
      toolCallId: "srvtool_code",
      toolName: "code_execution",
      block: {
        type: "code_execution_tool_result",
        tool_use_id: "srvtool_code",
        content: {
          type: "code_execution_result",
          stdout: "2\n",
          stderr: "",
          return_code: 0,
          content: [{ type: "code_execution_output", file_id: "file_1" }],
        },
      },
      expected: {
        type: "code_execution_result",
        stdout: "2\n",
        stderr: "",
        returnCode: 0,
        content: [{ type: "code_execution_output", fileId: "file_1" }],
      },
    }, {
      toolCallId: "srvtool_encrypted",
      toolName: "code_execution",
      block: {
        type: "code_execution_tool_result",
        tool_use_id: "srvtool_encrypted",
        content: {
          type: "encrypted_code_execution_result",
          encrypted_stdout: "opaque",
          stderr: "",
          return_code: 0,
          content: [],
        },
      },
      expected: {
        type: "encrypted_code_execution_result",
        encryptedStdout: "opaque",
        stderr: "",
        returnCode: 0,
        content: [],
      },
    }, {
      toolCallId: "srvtool_bash",
      toolName: "bash_code_execution",
      block: {
        type: "bash_code_execution_tool_result",
        tool_use_id: "srvtool_bash",
        content: {
          type: "bash_code_execution_result",
          stdout: "done\n",
          stderr: "",
          return_code: 0,
          content: [{ type: "bash_code_execution_output", file_id: "file_2" }],
        },
      },
      expected: {
        type: "bash_code_execution_result",
        stdout: "done\n",
        stderr: "",
        returnCode: 0,
        content: [{ type: "bash_code_execution_output", fileId: "file_2" }],
      },
    }];

    for (const testCase of cases) {
      assertEquals(
        parseAnthropicServerToolResult(
          testCase.block,
          new Map([[testCase.toolCallId, testCase.toolName]]),
        ),
        {
          toolCallId: testCase.toolCallId,
          toolName: testCase.toolName,
          result: testCase.expected,
        },
      );
    }
  });

  it("normalizes every text-editor code-execution result variant", () => {
    const registry = new Map([["srvtool_editor", "text_editor_code_execution"]]);
    const parseContent = (content: unknown) =>
      parseAnthropicServerToolResult({
        type: "text_editor_code_execution_tool_result",
        tool_use_id: "srvtool_editor",
        content,
      }, registry)?.result;

    assertEquals(
      parseContent({
        type: "text_editor_code_execution_view_result",
        content: "line one",
        file_type: "text",
        num_lines: 1,
        start_line: 1,
        total_lines: 1,
      }),
      {
        type: "text_editor_code_execution_view_result",
        content: "line one",
        fileType: "text",
        numLines: 1,
        startLine: 1,
        totalLines: 1,
      },
    );
    assertEquals(
      parseContent({
        type: "text_editor_code_execution_create_result",
        is_file_update: false,
      }),
      {
        type: "text_editor_code_execution_create_result",
        isFileUpdate: false,
      },
    );
    assertEquals(
      parseContent({
        type: "text_editor_code_execution_str_replace_result",
        lines: null,
        old_start: null,
        old_lines: null,
        new_start: null,
        new_lines: null,
      }),
      {
        type: "text_editor_code_execution_str_replace_result",
        lines: null,
        oldStart: null,
        oldLines: null,
        newStart: null,
        newLines: null,
      },
    );
  });

  it("preserves official server-tool error codes and rejects unknown ones", () => {
    const cases = [{
      outerType: "code_execution_tool_result",
      contentType: "code_execution_tool_result_error",
      toolCallId: "srvtool_code_error",
      toolName: "code_execution",
      code: "invalid_tool_input",
    }, {
      outerType: "bash_code_execution_tool_result",
      contentType: "bash_code_execution_tool_result_error",
      toolCallId: "srvtool_bash_error",
      toolName: "bash_code_execution",
      code: "output_file_too_large",
    }, {
      outerType: "text_editor_code_execution_tool_result",
      contentType: "text_editor_code_execution_tool_result_error",
      toolCallId: "srvtool_editor_error",
      toolName: "text_editor_code_execution",
      code: "file_not_found",
      errorMessage: "missing.txt",
    }];

    for (const testCase of cases) {
      const parsed = parseAnthropicServerToolResult({
        type: testCase.outerType,
        tool_use_id: testCase.toolCallId,
        content: {
          type: testCase.contentType,
          error_code: testCase.code,
          ...(testCase.errorMessage === undefined ? {} : { error_message: testCase.errorMessage }),
        },
      }, new Map([[testCase.toolCallId, testCase.toolName]]));
      assertEquals(parsed?.isError, true);
      assertInstanceOf(parsed?.result, AnthropicServerToolResultError);
      assertEquals((parsed?.result as AnthropicServerToolResultError).code, testCase.code);
      assertEquals(
        (parsed?.result as AnthropicServerToolResultError).detail,
        testCase.errorMessage,
      );
    }

    assertEquals(
      parseAnthropicServerToolResult({
        type: "code_execution_tool_result",
        tool_use_id: "srvtool_bad_error",
        content: {
          type: "code_execution_tool_result_error",
          error_code: "future_unverified_error",
        },
      }, new Map([["srvtool_bad_error", "code_execution"]])),
      undefined,
    );
  });

  it("normalizes MCP string and text-block results and their error flag", () => {
    const registry = new Map([["mcptool_echo", "echo"]]);
    assertEquals(
      parseAnthropicServerToolResult({
        type: "mcp_tool_result",
        tool_use_id: "mcptool_echo",
        is_error: false,
        content: "hello",
      }, registry),
      {
        toolCallId: "mcptool_echo",
        toolName: "echo",
        result: "hello",
      },
    );
    assertEquals(
      parseAnthropicServerToolResult({
        type: "mcp_tool_result",
        tool_use_id: "mcptool_echo",
        is_error: true,
        content: [{
          type: "text",
          text: "remote failure",
          citations: null,
        }],
      }, registry),
      {
        toolCallId: "mcptool_echo",
        toolName: "echo",
        result: [{ type: "text", text: "remote failure", citations: null }],
        isError: true,
      },
    );
  });

  it("fails closed on malformed provider-native result variants", () => {
    const malformed = [{
      type: "code_execution_tool_result",
      tool_use_id: "srvtool_code",
      content: {
        type: "code_execution_result",
        stdout: "ok",
        stderr: "",
        return_code: "0",
        content: [],
      },
    }, {
      type: "text_editor_code_execution_tool_result",
      tool_use_id: "srvtool_editor",
      content: {
        type: "text_editor_code_execution_view_result",
        content: "ok",
        file_type: "binary",
        num_lines: 1,
        start_line: 1,
        total_lines: 1,
      },
    }, {
      type: "mcp_tool_result",
      tool_use_id: "mcptool_missing_name",
      is_error: false,
      content: "hello",
    }];

    for (const block of malformed) {
      assertEquals(
        parseAnthropicServerToolResult(
          block,
          new Map([
            ["srvtool_code", "code_execution"],
            ["srvtool_editor", "text_editor_code_execution"],
          ]),
        ),
        undefined,
      );
    }
  });

  it("rejects orphan results and non-integral execution metadata", () => {
    const result = {
      type: "code_execution_tool_result",
      tool_use_id: "srvtool_code",
      content: {
        type: "code_execution_result",
        stdout: "ok",
        stderr: "",
        return_code: 0,
        content: [],
      },
    };
    assertEquals(parseAnthropicServerToolResult(result, new Map()), undefined);
    assertEquals(
      parseAnthropicServerToolResult(
        {
          ...result,
          content: {
            ...result.content,
            return_code: 0.5,
          },
        },
        new Map([["srvtool_code", "code_execution"]]),
      ),
      undefined,
    );
    assertEquals(
      parseAnthropicServerToolResult(
        {
          type: "text_editor_code_execution_tool_result",
          tool_use_id: "srvtool_editor",
          content: {
            type: "text_editor_code_execution_view_result",
            content: "line",
            file_type: "text",
            num_lines: -1,
            start_line: 1,
            total_lines: 1,
          },
        },
        new Map([["srvtool_editor", "text_editor_code_execution"]]),
      ),
      undefined,
    );
  });
});
