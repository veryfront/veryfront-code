import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createOpenAIRawResponseMetadata,
  MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES,
  MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS,
  MAX_OPENAI_WEB_SEARCH_TEXT_BYTES,
  normalizeOpenAIWebSearchCall,
  readOpenAIRawResponseOutputItems,
  resolveOpenAIWebSearchDescriptor,
  validateOpenAIUrlCitation,
} from "./openai-web-search.ts";
import { MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES } from "./openai-tool-input.ts";

const invalid = (issue: string) => new Error(issue);

function captureThrownError(
  fn: () => unknown,
  expectedType?: typeof Error,
  messageIncludes?: string,
): Error {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const actualName = error.name;
    if (expectedType && !(error instanceof expectedType)) {
      throw new Error(`Expected ${expectedType.name}, received ${actualName}`);
    }
    if (messageIncludes && !error.message.includes(messageIncludes)) {
      throw new Error(`Expected error message to include ${messageIncludes}`);
    }
    return error;
  }
  throw new Error("Expected function to throw");
}

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

describe("ext-llm-openai/openai-web-search", () => {
  it("maps the four supported provider tool revisions and preserves the runtime name", () => {
    for (
      const providerType of [
        "web_search",
        "web_search_2025_08_26",
        "web_search_preview",
        "web_search_preview_2025_03_11",
      ]
    ) {
      assertEquals(
        resolveOpenAIWebSearchDescriptor([{
          type: "provider",
          id: `openai.${providerType}`,
          name: "research",
          args: { searchContextSize: "high" },
        }]),
        {
          name: "research",
          requestTool: {
            type: providerType,
            search_context_size: "high",
          },
        },
      );
    }
  });

  it("rejects ambiguous, unsupported, and malformed provider tool definitions", () => {
    assertThrows(
      () =>
        resolveOpenAIWebSearchDescriptor([{
          type: "provider",
          id: "openai.code_interpreter",
          name: "code",
          args: {},
        }]),
      TypeError,
      "Unsupported OpenAI provider tool",
    );
    assertThrows(
      () =>
        resolveOpenAIWebSearchDescriptor([
          {
            type: "provider",
            id: "openai.web_search",
            name: "one",
            args: {},
          },
          {
            type: "provider",
            id: "openai.web_search_preview",
            name: "two",
            args: {},
          },
        ]),
      TypeError,
      "Only one OpenAI web-search provider tool",
    );
    assertThrows(
      () =>
        resolveOpenAIWebSearchDescriptor([{
          type: "provider",
          id: "openai.web_search",
          name: "",
          args: {},
        }]),
      TypeError,
      "name was malformed",
    );
    assertThrows(
      () =>
        resolveOpenAIWebSearchDescriptor([{
          type: "provider",
          id: "openai.web_search",
          name: "web",
          args: { searchContextSize: "maximum" },
        }]),
      TypeError,
      "arguments were unsupported",
    );
  });

  it("normalizes terminal search, open-page, find-in-page, and incomplete calls", () => {
    assertEquals(
      normalizeOpenAIWebSearchCall({
        id: "ws_search",
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          queries: ["one", "two"],
          sources: [{ type: "url", url: "https://example.test/source" }],
        },
      }, invalid),
      {
        id: "ws_search",
        input: '{"type":"search","queries":["one","two"]}',
        result: {
          status: "completed",
          sources: [{ type: "url", url: "https://example.test/source" }],
        },
        isError: false,
      },
    );
    assertEquals(
      normalizeOpenAIWebSearchCall({
        id: "ws_redacted_search",
        type: "web_search_call",
        status: "completed",
        action: { type: "search", queries: [] },
      }, invalid),
      {
        id: "ws_redacted_search",
        input: '{"type":"search","queries":[]}',
        result: { status: "completed" },
        isError: false,
      },
    );
    assertEquals(
      normalizeOpenAIWebSearchCall({
        id: "ws_search_without_queries",
        type: "web_search_call",
        status: "completed",
        action: { type: "search" },
      }, invalid),
      {
        id: "ws_search_without_queries",
        input: '{"type":"search"}',
        result: { status: "completed" },
        isError: false,
      },
    );
    assertEquals(
      normalizeOpenAIWebSearchCall({
        id: "ws_open",
        type: "web_search_call",
        status: "completed",
        action: { type: "open_page", url: "https://example.test/page" },
      }, invalid).input,
      '{"type":"open_page","url":"https://example.test/page"}',
    );
    assertEquals(
      normalizeOpenAIWebSearchCall({
        id: "ws_find",
        type: "web_search_call",
        status: "incomplete",
        action: {
          type: "find_in_page",
          url: "https://example.test/page",
          pattern: "needle",
        },
      }, invalid),
      {
        id: "ws_find",
        input: '{"type":"find_in_page","url":"https://example.test/page","pattern":"needle"}',
        result: {
          status: "incomplete",
          action: {
            type: "find_in_page",
            url: "https://example.test/page",
            pattern: "needle",
          },
        },
        isError: true,
      },
    );
    assertEquals(
      normalizeOpenAIWebSearchCall({
        id: "ws_failed_open",
        type: "web_search_call",
        status: "failed",
        action: { type: "open_page", url: null },
      }, invalid),
      {
        id: "ws_failed_open",
        input: '{"type":"open_page","url":null}',
        result: {
          status: "failed",
          action: { type: "open_page", url: null },
        },
        isError: true,
      },
    );
  });

  it("bounds and validates web-search actions and citation URLs", () => {
    for (
      const action of [
        { type: "search", query: "x".repeat(MAX_OPENAI_WEB_SEARCH_TEXT_BYTES + 1) },
        {
          type: "search",
          queries: Array.from(
            { length: 17 },
            () => "x".repeat(MAX_OPENAI_WEB_SEARCH_TEXT_BYTES),
          ),
        },
        { type: "open_page", url: "https://user:secret@example.test/" },
        { type: "open_page", url: "https://example.test/\u0000path" },
        { type: "open_page", url: "https://example.test/\u007Fpath" },
        {
          type: "find_in_page",
          url: "https://example.test/",
          pattern: "",
        },
      ]
    ) {
      assertThrows(
        () =>
          normalizeOpenAIWebSearchCall({
            id: "ws_invalid",
            type: "web_search_call",
            status: "completed",
            action,
          }, invalid),
        Error,
      );
    }

    const citation = {
      type: "url_citation",
      start_index: 0,
      end_index: 6,
      url: "https://example.test/source",
      title: "Source",
    };
    assertEquals(validateOpenAIUrlCitation(citation, invalid), citation);
    assertThrows(
      () =>
        validateOpenAIUrlCitation({
          ...citation,
          url: "https://user:secret@example.test/source",
        }, invalid),
      Error,
      "URL citation annotation was malformed",
    );
    assertThrows(
      () =>
        validateOpenAIUrlCitation({
          ...citation,
          url: " https://example.test/source ",
        }, invalid),
      Error,
      "URL citation annotation was malformed",
    );
  });

  it("validates bounded exact raw output metadata before replay", () => {
    const rawItems = [
      {
        id: "ws_1",
        type: "web_search_call",
        status: "completed",
        action: { type: "search", query: "Veryfront" },
      },
      {
        id: "msg_1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{
          type: "output_text",
          text: "Result",
          annotations: [{
            type: "url_citation",
            start_index: 0,
            end_index: 6,
            url: "https://example.test/",
            title: "Example",
          }],
        }],
      },
    ];
    const metadata = createOpenAIRawResponseMetadata(rawItems);
    assertEquals(readOpenAIRawResponseOutputItems(metadata), rawItems);
    rawItems[0]!.action = { type: "search", query: "mutated" };
    rawItems.push({
      id: "ws_2",
      type: "web_search_call",
      status: "completed",
      action: { type: "search", query: "later mutation" },
    });
    assertEquals(readOpenAIRawResponseOutputItems(metadata), [{
      id: "ws_1",
      type: "web_search_call",
      status: "completed",
      action: { type: "search", query: "Veryfront" },
    }, {
      id: "msg_1",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{
        type: "output_text",
        text: "Result",
        annotations: [{
          type: "url_citation",
          start_index: 0,
          end_index: 6,
          url: "https://example.test/",
          title: "Example",
        }],
      }],
    }]);
    assertEquals(
      readOpenAIRawResponseOutputItems({
        openai: { responseId: "resp_legacy" },
      }),
      undefined,
    );
    assertEquals(
      readOpenAIRawResponseOutputItems(createOpenAIRawResponseMetadata([{
        id: "msg_without_annotations",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Result" }],
      }])),
      [{
        id: "msg_without_annotations",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "Result" }],
      }],
    );

    assertThrows(
      () =>
        readOpenAIRawResponseOutputItems(
          createOpenAIRawResponseMetadata([]),
        ),
      TypeError,
      "contained no output items",
    );
    assertThrows(
      () =>
        readOpenAIRawResponseOutputItems(createOpenAIRawResponseMetadata([{
          id: "fc_1",
          type: "function_call",
          call_id: "call_1",
          name: "lookup",
          arguments: "not JSON",
        }])),
      TypeError,
      "item was malformed",
    );
    assertThrows(
      () =>
        readOpenAIRawResponseOutputItems(createOpenAIRawResponseMetadata([{
          id: "fc_large",
          type: "function_call",
          call_id: "call_large",
          name: "lookup",
          arguments: JSON.stringify({
            value: "x".repeat(MAX_OPENAI_STREAM_TOOL_ARGUMENT_BYTES),
          }),
        }])),
      TypeError,
      "item was malformed",
    );
    assertThrows(
      () =>
        readOpenAIRawResponseOutputItems(createOpenAIRawResponseMetadata([{
          id: "msg_large",
          type: "message",
          role: "assistant",
          content: [{
            type: "output_text",
            text: "x".repeat(MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES),
          }],
        }])),
      TypeError,
      `exceeded ${MAX_OPENAI_RAW_RESPONSE_METADATA_BYTES} UTF-8 bytes`,
    );
    assertThrows(
      () =>
        readOpenAIRawResponseOutputItems(createOpenAIRawResponseMetadata([{
          id: "msg_many_annotations",
          type: "message",
          role: "assistant",
          content: [{
            type: "output_text",
            text: "x",
            annotations: Array.from(
              { length: MAX_OPENAI_RAW_RESPONSE_OUTPUT_ITEMS + 1 },
              () => ({
                type: "url_citation",
                start_index: 0,
                end_index: 1,
                url: "https://example.test/",
                title: "",
              }),
            ),
          }],
        }])),
      TypeError,
      "item was malformed",
    );
    assertThrows(
      () =>
        readOpenAIRawResponseOutputItems(createOpenAIRawResponseMetadata([{
          id: "reasoning_1",
          type: "reasoning",
          summary: [{
            id: "x".repeat(513),
            type: "summary_text",
            text: "Summary",
          }],
        }])),
      TypeError,
      "item was malformed",
    );
  });

  it("rejects replay metadata accessors and serialization hooks without invoking them", () => {
    let accessorReads = 0;
    const hostileAction = Object.defineProperty(
      { type: "search" },
      "query",
      {
        enumerable: true,
        get() {
          accessorReads += 1;
          throw new Error("private metadata diagnostic");
        },
      },
    );
    const accessorError = captureThrownError(
      () =>
        createOpenAIRawResponseMetadata([{
          id: "ws_accessor",
          type: "web_search_call",
          status: "completed",
          action: hostileAction,
        }]),
      TypeError,
      "OpenAI raw response metadata was not valid bounded JSON",
    );
    assertEquals(accessorReads, 0);
    assertEquals(accessorError.message.includes("private metadata diagnostic"), false);

    let serializationHookCalls = 0;
    const hookError = captureThrownError(
      () =>
        createOpenAIRawResponseMetadata([{
          id: "ws_to_json",
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "Veryfront",
            toJSON() {
              serializationHookCalls += 1;
              return { type: "search", query: "changed" };
            },
          },
        }]),
      TypeError,
      "OpenAI raw response metadata was not valid bounded JSON",
    );
    assertEquals(serializationHookCalls, 0);
    assertEquals(hookError.cause, undefined);

    let namespaceReads = 0;
    const providerMetadata = Object.defineProperty({}, "openai", {
      enumerable: true,
      get() {
        namespaceReads += 1;
        throw new Error("private namespace diagnostic");
      },
    }) as Record<string, unknown>;
    const namespaceError = captureThrownError(
      () => readOpenAIRawResponseOutputItems(providerMetadata),
      TypeError,
      "OpenAI provider metadata was malformed",
    );
    assertEquals(namespaceReads, 0);
    assertEquals(namespaceError.message.includes("private namespace diagnostic"), false);

    let proxyPropertyReads = 0;
    const proxiedItems = new Proxy([{
      id: "ws_proxy",
      type: "web_search_call",
      status: "completed",
      action: { type: "search", query: "Veryfront" },
    }], {
      get() {
        proxyPropertyReads += 1;
        throw new Error("proxy property read");
      },
    });
    const proxyError = captureThrownError(
      () =>
        readOpenAIRawResponseOutputItems({
          openai: { rawResponseOutputItems: proxiedItems },
        }),
      TypeError,
      "OpenAI raw response metadata was not valid bounded JSON",
    );
    assertEquals(proxyPropertyReads, 0);
    assertEquals(proxyError.cause, undefined);
  });

  it("accepts plain raw response metadata without Proxy detection", async () => {
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
      const {
        createOpenAIRawResponseMetadata,
        readOpenAIRawResponseOutputItems,
      } = await import("./extensions/ext-llm-openai/src/openai-web-search.ts");

      const metadata = createOpenAIRawResponseMetadata([{
        id: "ws_edge",
        type: "web_search_call",
        status: "completed",
        action: { type: "search", query: "Veryfront" },
      }]);
      console.log(JSON.stringify({
        canIdentifyProxyWithoutHooks,
        items: readOpenAIRawResponseOutputItems(metadata),
      }));
    `);
    assertEquals(result, {
      canIdentifyProxyWithoutHooks: false,
      items: [{
        id: "ws_edge",
        type: "web_search_call",
        status: "completed",
        action: { type: "search", query: "Veryfront" },
      }],
    });
  });
});
