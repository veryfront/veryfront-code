import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  convertToTextGenerationRuntimeMessage,
  convertToTextGenerationRuntimeMessages,
  convertToTextGenerationRuntimeRequestMessages,
} from "./text-generation-runtime-message-converter.ts";
import type {
  TextGenerationRuntimeAssistantMessage,
  TextGenerationRuntimeMessage,
  TextGenerationRuntimeToolMessage,
  TextGenerationRuntimeUserMessage,
} from "./text-generation-runtime-message-types.ts";
import type { Message } from "../types.ts";
import { attachProviderMetadata, markProviderReplayDelivered } from "./provider-metadata.ts";

describe("text-generation-runtime-message-converter", () => {
  describe("convertToTextGenerationRuntimeMessage", () => {
    it("converts a system message", () => {
      const msg: Message = {
        id: "s1",
        role: "system",
        parts: [{ type: "text", text: "You are helpful" }],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result, { role: "system", content: "You are helpful" });
    });

    it("converts a user message", () => {
      const msg: Message = {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result, { role: "user", content: "Hello" });
    });

    it("concatenates multiple text parts in user message", () => {
      const msg: Message = {
        id: "u2",
        role: "user",
        parts: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result, { role: "user", content: "Hello world" });
    });

    it("preserves user file parts as provider-visible attachment context", () => {
      const msg = {
        id: "u-file",
        role: "user",
        parts: [
          { type: "text", text: "Sent with attachments" },
          {
            type: "file",
            url: "https://signed.example.com/invoice.pdf",
            mediaType: "application/pdf",
            filename: "sample-attachment.pdf",
            uploadId: "test-upload-id",
            uploadPath: "_chat/test-user-id/test-upload-sample-attachment.pdf",
          },
        ],
      } as unknown as Message;

      const result = convertToTextGenerationRuntimeMessage(msg);

      assertEquals(result.role, "user");
      const content = (result as TextGenerationRuntimeUserMessage).content;
      if (!Array.isArray(content)) {
        throw new Error("Expected user content to preserve native file parts");
      }
      assertEquals(content[0], { type: "text", text: "Sent with attachments" });
      assertEquals(content[1], {
        type: "file",
        mediaType: "application/pdf",
        url: "https://signed.example.com/invoice.pdf",
        filename: "sample-attachment.pdf",
      });
      const text = content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
      assertStringIncludes(text, "<uploaded_files>");
      assertStringIncludes(text, "sample-attachment.pdf");
      assertStringIncludes(text, "test-upload-id");
      assertStringIncludes(text, "application/pdf");
    });

    it("keeps inline data: attachment bytes in the native file part only", () => {
      const msg = {
        id: "u-inline",
        role: "user",
        parts: [
          { type: "text", text: "look" },
          {
            type: "file",
            url: "data:image/png;base64,ABCPAYLOAD==",
            mediaType: "image/png",
            filename: "inline.png",
          },
        ],
      } as unknown as Message;

      const result = convertToTextGenerationRuntimeMessage(msg);

      const content = (result as TextGenerationRuntimeUserMessage).content;
      if (!Array.isArray(content)) {
        throw new Error("Expected user content to preserve native file parts");
      }
      assertEquals(content[1], {
        type: "file",
        mediaType: "image/png",
        url: "data:image/png;base64,ABCPAYLOAD==",
        filename: "inline.png",
      }, "inline bytes must ride in the native file part");
      const annotation = content.flatMap((part) => part.type === "text" ? [part.text] : []).join(
        "\n",
      );
      assertStringIncludes(annotation, "inline.png");
      assertStringIncludes(annotation, "image/png");
      assertEquals(
        annotation.includes("data:"),
        false,
        "the uploaded_files annotation must never inline a data: URL",
      );
    });

    it("names the attachment when its URL is one no provider can fetch", () => {
      // The chat upload handler mints this URL: with a storage backend that
      // has no external URL of its own it falls back to the app's own origin
      // (upload-handler.ts:426). A provider fetching `image_url.url` from its
      // own network resolves `localhost` to itself and answers with an opaque
      // 400, so the turn must fail here, naming the attachment instead.
      const msg = {
        id: "u-local-upload",
        role: "user",
        parts: [
          { type: "text", text: "what is in this image?" },
          {
            type: "file",
            url: "http://localhost:3000/api/chat/upload?id=blob_1",
            mediaType: "image/png",
            filename: "screenshot.png",
            uploadId: "blob_1",
          },
        ],
      } as unknown as Message;

      const error = assertThrows(
        () => convertToTextGenerationRuntimeMessage(msg),
        Error,
      ) as Error;
      assertStringIncludes(error.message, "screenshot.png");
      assertStringIncludes(error.message, "localhost");
    });

    it("keeps a loopback attachment for a runtime that fetches from this machine", () => {
      // A `server-local` runtime resolves `localhost` to the server the upload
      // handler is running on, so the URL it minted is reachable there. Only a
      // remote provider fetches from a network where it is not.
      const msg = {
        id: "u-local-runtime",
        role: "user",
        parts: [
          { type: "text", text: "what is in this image?" },
          {
            type: "file",
            url: "http://localhost:3000/api/chat/upload?id=blob_1",
            mediaType: "image/png",
            filename: "screenshot.png",
            uploadId: "blob_1",
          },
        ],
      } as unknown as Message;

      const result = convertToTextGenerationRuntimeMessage(msg, {
        requireInternetReachableAttachments: false,
      });

      const content = (result as TextGenerationRuntimeUserMessage).content;
      if (!Array.isArray(content)) {
        throw new Error("Expected user content to preserve native file parts");
      }
      const fileUrls = content.flatMap((part) =>
        part.type === "file" || part.type === "image" ? [part.url] : []
      );
      assertEquals(fileUrls, ["http://localhost:3000/api/chat/upload?id=blob_1"]);
    });

    it("separates user text from attachment context with a readable blank line", () => {
      const msg = {
        id: "u-file-spacing",
        role: "user",
        parts: [
          { type: "text", text: "Sent with attachments" },
          {
            type: "file",
            url: "https://signed.example.com/invoice.pdf",
            mediaType: "application/pdf",
            filename: "sample-attachment.pdf",
          },
        ],
      } as unknown as Message;

      const result = convertToTextGenerationRuntimeMessage(msg);

      const content = (result as TextGenerationRuntimeUserMessage).content;
      if (!Array.isArray(content)) {
        throw new Error("Expected user content to preserve native file parts");
      }
      const text = content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n\n");
      assertStringIncludes(text, "Sent with attachments\n\n<uploaded_files>");
    });

    it("does not start file-only user attachment context with blank lines", () => {
      const msg = {
        id: "u-file-only",
        role: "user",
        parts: [
          {
            type: "file",
            url: "https://signed.example.com/invoice.pdf",
            mediaType: "application/pdf",
            filename: "sample-attachment.pdf",
          },
        ],
      } as unknown as Message;

      const result = convertToTextGenerationRuntimeMessage(msg);

      const content = (result as TextGenerationRuntimeUserMessage).content;
      if (!Array.isArray(content)) {
        throw new Error("Expected user content to preserve native file parts");
      }
      const text = content.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n");
      assertEquals(text.startsWith("<uploaded_files>"), true);
    });

    it("converts an assistant message with text", () => {
      const msg: Message = {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Sure, I can help." }],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result.role, "assistant");
      const content = (result as TextGenerationRuntimeAssistantMessage).content;
      assertEquals(content.length, 1);
      assertEquals(content[0], { type: "text", text: "Sure, I can help." });
    });

    it("converts an assistant message with tool calls", () => {
      const msg: Message = {
        id: "a2",
        role: "assistant",
        parts: [
          { type: "text", text: "Let me search." },
          {
            type: "tool-search",
            toolCallId: "tc1",
            toolName: "search",
            args: { query: "test" },
          },
        ],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result.role, "assistant");
      const content = (result as TextGenerationRuntimeAssistantMessage).content;
      assertEquals(content.length, 2);
      assertEquals(content[0], { type: "text", text: "Let me search." });
      assertEquals(content[1], {
        type: "tool-call",
        toolCallId: "tc1",
        toolName: "search",
        input: { query: "test" },
      });
    });

    it("adds empty text for assistant message with no content", () => {
      const msg: Message = {
        id: "a3",
        role: "assistant",
        parts: [],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result.role, "assistant");
      const content = (result as TextGenerationRuntimeAssistantMessage).content;
      assertEquals(content.length, 1);
      assertEquals(content[0], { type: "text", text: "" });
    });

    it("converts a tool result message", () => {
      const msg: Message = {
        id: "t1",
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "search",
            result: { data: [1, 2, 3] },
          },
        ],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result.role, "tool");
      const content = (result as TextGenerationRuntimeToolMessage).content;
      assertEquals(content.length, 1);
      assertEquals(content[0], {
        type: "tool-result",
        toolCallId: "tc1",
        toolName: "search",
        output: { type: "json", value: { data: [1, 2, 3] } },
      });
    });

    it("converts a stored snake_case tool result message", () => {
      const msg = {
        id: "t-snake",
        role: "tool",
        parts: [
          {
            type: "tool_result",
            tool_call_id: "tc-snake",
            tool_name: "harvest__list_users",
            output: { users: [{ id: 1, name: "Ada" }] },
          },
        ],
      } as unknown as Message;

      const result = convertToTextGenerationRuntimeMessage(msg);

      assertEquals(result.role, "tool");
      assertEquals((result as TextGenerationRuntimeToolMessage).content, [
        {
          type: "tool-result",
          toolCallId: "tc-snake",
          toolName: "harvest__list_users",
          output: { type: "json", value: { users: [{ id: 1, name: "Ada" }] } },
        },
      ]);
    });

    it("handles tool result with missing toolName", () => {
      const msg: Message = {
        id: "t2",
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: "tc2",
            result: "done",
          } as Message["parts"][0],
        ],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      const content = (result as TextGenerationRuntimeToolMessage).content;
      assertEquals(content.length, 1);
      const firstPart = content[0];
      assertEquals(firstPart?.toolName, "unknown");
    });

    it("falls back to user role for unknown message roles", () => {
      const msg = {
        id: "x1",
        role: "custom" as Message["role"],
        parts: [{ type: "text", text: "fallback" }],
      } as Message;
      const result = convertToTextGenerationRuntimeMessage(msg);
      assertEquals(result.role, "user");
      assertEquals(result.content, "fallback");
    });

    it("handles tool-call type parts in assistant messages", () => {
      const msg: Message = {
        id: "a4",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: "tc-direct",
            toolName: "calc",
            args: { expr: "1+1" },
          },
        ],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      const content = (result as TextGenerationRuntimeAssistantMessage).content;
      const firstPart = content[0];
      assertEquals(content.length, 1);
      assertEquals(firstPart?.type, "tool-call");
      if (firstPart?.type !== "tool-call") {
        throw new Error("Expected tool-call content");
      }
      assertEquals(firstPart.toolName, "calc");
    });

    it("skips tool-result parts in assistant messages", () => {
      const msg: Message = {
        id: "a5",
        role: "assistant",
        parts: [
          { type: "text", text: "response" },
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "foo",
            result: "bar",
          } as Message["parts"][0],
        ],
      };
      const result = convertToTextGenerationRuntimeMessage(msg);
      const content = (result as TextGenerationRuntimeAssistantMessage).content;
      assertEquals(content.length, 1);
      const firstPart = content[0];
      assertEquals(firstPart?.type, "text");
    });

    it("skips provider-executed tool-call parts in assistant messages", () => {
      const msg = {
        id: "a-provider-tool",
        role: "assistant",
        parts: [
          {
            type: "tool-web_search",
            toolCallId: "toolu_search",
            toolName: "web_search",
            args: { query: "Swedish tax residency" },
            providerExecuted: true,
          },
          { type: "text", text: "The answer cites Skatteverket." },
        ],
      } as unknown as Message;

      const result = convertToTextGenerationRuntimeMessage(msg);

      assertEquals(result.role, "assistant");
      assertEquals((result as TextGenerationRuntimeAssistantMessage).content, [
        { type: "text", text: "The answer cites Skatteverket." },
      ]);
    });
  });

  describe("convertToTextGenerationRuntimeMessages", () => {
    it("converts an array of messages", () => {
      const messages: Message[] = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "hello" }] },
      ];
      const result = convertToTextGenerationRuntimeMessages(messages);
      assertEquals(result.length, 2);
      assertEquals(result[0]?.role, "user");
      assertEquals(result[1]?.role, "assistant");
    });

    it("returns empty array for empty input", () => {
      assertEquals(convertToTextGenerationRuntimeMessages([]), []);
    });

    it("omits assistant messages that have no provider-sendable content", () => {
      const messages: Message[] = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "list my repos" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [{
            type: "error",
            code: "agent-provider-error",
            message: "veryfront-cloud request failed",
          }],
        } as unknown as Message,
        { id: "u2", role: "user", parts: [{ type: "text", text: "try again" }] },
      ];

      assertEquals(convertToTextGenerationRuntimeMessages(messages), [
        { role: "user", content: "list my repos" },
        { role: "user", content: "try again" },
      ]);
    });

    it("keeps an exact-replay assistant turn that has only canonical reasoning", () => {
      const providerMetadata = {
        google: {
          rawAssistantParts: [{
            text: "Private reasoning.",
            thought: true,
            thoughtSignature: "thought-signature",
          }],
        },
      };
      const message = attachProviderMetadata({
        id: "a-reasoning",
        role: "assistant",
        parts: [{
          type: "reasoning",
          text: "Private reasoning.",
          signature: "thought-signature",
        }],
      }, providerMetadata);

      assertEquals(convertToTextGenerationRuntimeMessages([message]), [{
        role: "assistant",
        content: [{ type: "text", text: "" }],
        providerMetadata,
      }]);
    });

    it("distributes replay groups across assistant segments split by a client tool", () => {
      const rawToolUse = {
        type: "tool_use",
        id: "lookup-1",
        name: "lookup",
        input: { query: "Veryfront" },
      };
      const rawText = { type: "text", text: "Found it." };
      const message = attachProviderMetadata({
        id: "assistant-split-replay",
        role: "assistant",
        parts: [{
          type: "tool-lookup",
          toolCallId: rawToolUse.id,
          toolName: rawToolUse.name,
          args: rawToolUse.input,
        }, {
          type: "tool-result",
          toolCallId: rawToolUse.id,
          toolName: rawToolUse.name,
          result: { matches: 1 },
        }, {
          type: "text",
          text: rawText.text,
        }],
      } as Message, {
        anthropic: { rawAssistantMessages: [[rawToolUse], [rawText]] },
      });

      const converted = convertToTextGenerationRuntimeMessages([message]);
      assertEquals(
        converted.filter((entry) => entry.role === "assistant").map((entry) =>
          entry.providerMetadata
        ),
        [{ anthropic: { rawAssistantMessages: [[rawToolUse]] } }, {
          anthropic: { rawAssistantMessages: [[rawText]] },
        }],
      );
    });

    it("omits provider-executed tool-only assistant messages from replay", () => {
      const messages = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "search tax guidance" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [{
            type: "tool-web_search",
            toolCallId: "toolu_search",
            toolName: "web_search",
            args: { query: "site:skatteverket.se tax residency" },
            providerExecuted: true,
          }],
        },
        { id: "u2", role: "user", parts: [{ type: "text", text: "try again" }] },
      ] as unknown as Message[];

      assertEquals(convertToTextGenerationRuntimeMessages(messages), [
        { role: "user", content: "search tax guidance" },
        { role: "user", content: "try again" },
      ]);
    });

    it("omits an ordinary call that collides with a provider-executed call ID", () => {
      const messages = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "first" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [{
            type: "tool-web_search",
            toolCallId: "shared-call",
            toolName: "web_search",
            providerExecuted: true,
          }, {
            type: "tool-call",
            toolCallId: "shared-call",
            toolName: "local_search",
            input: {},
          }],
        },
        { id: "u2", role: "user", parts: [{ type: "text", text: "second" }] },
      ] as unknown as Message[];

      assertEquals(convertToTextGenerationRuntimeMessages(messages), [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ]);
    });

    it("retains provider-executed call IDs across assistant messages", () => {
      const messages = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "first" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [{
            type: "tool-web_search",
            toolCallId: "shared-call",
            toolName: "web_search",
            providerExecuted: true,
          }],
        },
        {
          id: "a2",
          role: "assistant",
          parts: [{
            type: "tool-call",
            toolCallId: "shared-call",
            toolName: "local_search",
            input: {},
          }],
        },
        { id: "u2", role: "user", parts: [{ type: "text", text: "second" }] },
      ] as unknown as Message[];

      assertEquals(convertToTextGenerationRuntimeMessages(messages), [
        { role: "user", content: "first" },
        { role: "user", content: "second" },
      ]);
    });

    it("omits provider-executed tool result messages from replay", () => {
      const messages = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "search tax guidance" }] },
        {
          id: "t1",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "toolu_search",
            toolName: "web_search",
            result: { results: [{ title: "Skatteverket" }] },
            providerExecuted: true,
          }],
        },
        { id: "u2", role: "user", parts: [{ type: "text", text: "try again" }] },
      ] as unknown as Message[];

      assertEquals(convertToTextGenerationRuntimeMessages(messages), [
        { role: "user", content: "search tax guidance" },
        { role: "user", content: "try again" },
      ]);
    });

    it("omits provider-executed tool call and result history before a follow-up", () => {
      const messages = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "search tax guidance" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-web_search",
              toolCallId: "toolu_search",
              toolName: "web_search",
              args: { query: "site:skatteverket.se tax residency" },
              providerExecuted: true,
            },
            { type: "text", text: "Skatteverket explains unlimited tax liability." },
          ],
        },
        {
          id: "t1",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "toolu_search",
            toolName: "web_search",
            result: { results: [{ title: "Skatteverket" }] },
          }],
        },
        { id: "u2", role: "user", parts: [{ type: "text", text: "cite the source" }] },
      ] as unknown as Message[];

      assertEquals(convertToTextGenerationRuntimeMessages(messages), [
        { role: "user", content: "search tax guidance" },
        {
          role: "assistant",
          content: [{ type: "text", text: "Skatteverket explains unlimited tax liability." }],
        },
        { role: "user", content: "cite the source" },
      ]);
    });

    it("keeps a later local tool result when its id matches an earlier provider tool call", () => {
      const messages = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "search tax guidance" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            {
              type: "tool-web_search",
              toolCallId: "toolu_reused",
              toolName: "web_search",
              args: { query: "site:skatteverket.se tax residency" },
              providerExecuted: true,
            },
            { type: "text", text: "Skatteverket explains unlimited tax liability." },
          ],
        },
        { id: "u2", role: "user", parts: [{ type: "text", text: "search local docs" }] },
        {
          id: "a2",
          role: "assistant",
          parts: [{
            type: "tool-call",
            toolCallId: "toolu_reused",
            toolName: "searchDocs",
            args: { query: "local source" },
          }],
        },
        {
          id: "t1",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "toolu_reused",
            toolName: "searchDocs",
            result: { results: [{ title: "Local source" }] },
          }],
        },
      ] as unknown as Message[];

      assertEquals(convertToTextGenerationRuntimeMessages(messages), [
        { role: "user", content: "search tax guidance" },
        {
          role: "assistant",
          content: [{ type: "text", text: "Skatteverket explains unlimited tax liability." }],
        },
        { role: "user", content: "search local docs" },
        {
          role: "assistant",
          content: [{
            type: "tool-call",
            toolCallId: "toolu_reused",
            toolName: "searchDocs",
            input: { query: "local source" },
          }],
        },
        {
          role: "tool",
          content: [{
            type: "tool-result",
            toolCallId: "toolu_reused",
            toolName: "searchDocs",
            output: { type: "json", value: { results: [{ title: "Local source" }] } },
          }],
        },
      ]);
    });

    it("splits inline assistant tool results into provider-adjacent tool messages", () => {
      const messages = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "search docs" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "text", text: "I'll search the docs." },
            {
              type: "tool_call",
              id: "tc-search",
              name: "web_search",
              input: { query: "code framework components page syntax" },
              state: "completed",
            },
            {
              type: "tool_result",
              tool_call_id: "tc-search",
              output: { results: [{ title: "Components" }] },
            },
            { type: "text", text: "I found the relevant source." },
          ],
        },
        { id: "u2", role: "user", parts: [{ type: "text", text: "list your tools" }] },
      ] as unknown as Message[];

      const result = convertToTextGenerationRuntimeMessages(messages);

      assertEquals(result, [
        { role: "user", content: "search docs" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I'll search the docs." },
            {
              type: "tool-call",
              toolCallId: "tc-search",
              toolName: "web_search",
              input: { query: "code framework components page syntax" },
            },
          ],
        },
        {
          role: "tool",
          content: [{
            type: "tool-result",
            toolCallId: "tc-search",
            toolName: "web_search",
            output: { type: "json", value: { results: [{ title: "Components" }] } },
          }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "I found the relevant source." }],
        },
        { role: "user", content: "list your tools" },
      ]);
    });

    it("keeps multiple tool results from one replay message together for parallel tool calls", () => {
      const messages: Message[] = [{
        id: "tool_batch",
        role: "tool",
        parts: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "a",
            result: "r1",
          },
          {
            type: "tool-result",
            toolCallId: "tc2",
            toolName: "b",
            result: "r2",
          },
        ],
      }];

      const result = convertToTextGenerationRuntimeMessages(messages);

      assertEquals(result.length, 1);
      assertEquals(result[0], {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "a",
            output: { type: "json", value: "r1" },
          },
          {
            type: "tool-result",
            toolCallId: "tc2",
            toolName: "b",
            output: { type: "json", value: "r2" },
          },
        ],
      });
    });

    it("groups consecutive tool result messages after one assistant turn", () => {
      const messages: Message[] = [
        {
          id: "assistant_1",
          role: "assistant",
          parts: [
            {
              type: "tool-call",
              toolCallId: "tc1",
              toolName: "calendar",
              args: { day: "today" },
            },
            {
              type: "tool-call",
              toolCallId: "tc2",
              toolName: "gmail",
              args: { query: "newer_than:1d" },
            },
          ],
        },
        {
          id: "tool_1",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "calendar",
            result: { events: 1 },
          }],
        },
        {
          id: "tool_2",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "tc2",
            toolName: "gmail",
            result: { messages: 20 },
          }],
        },
        {
          id: "assistant_2",
          role: "assistant",
          parts: [{ type: "text", text: "I found both results." }],
        },
      ];

      const result = convertToTextGenerationRuntimeMessages(messages);

      assertEquals(result.length, 3);
      assertEquals(result[1], {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "calendar",
            output: { type: "json", value: { events: 1 } },
          },
          {
            type: "tool-result",
            toolCallId: "tc2",
            toolName: "gmail",
            output: { type: "json", value: { messages: 20 } },
          },
        ],
      });
      assertEquals(result[2], {
        role: "assistant",
        content: [{ type: "text", text: "I found both results." }],
      });
    });

    it("preserves repeated tool result positions for repeated tool call ids", () => {
      const messages: Message[] = [
        {
          id: "assistant_1",
          role: "assistant",
          parts: [{
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "search",
            args: { query: "old" },
          }],
        },
        {
          id: "tool_1",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "search",
            result: { files: ["old.ts"] },
          }],
        },
        {
          id: "assistant_2",
          role: "assistant",
          parts: [{
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "search",
            args: { query: "new" },
          }],
        },
        {
          id: "tool_2",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "tc1",
            toolName: "search",
            result: { files: ["new.ts"] },
          }],
        },
      ];

      const result = convertToTextGenerationRuntimeMessages(messages);

      assertEquals(result.length, 4);
      assertEquals(result[0], {
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "search",
          input: { query: "old" },
        }],
      });
      assertEquals(result[1], {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "search",
          output: { type: "json", value: { files: ["old.ts"] } },
        }],
      });
      assertEquals(result[2], {
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "search",
          input: { query: "new" },
        }],
      });
      assertEquals(result[3], {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "search",
          output: { type: "json", value: { files: ["new.ts"] } },
        }],
      });
    });
  });

  describe("convertToTextGenerationRuntimeRequestMessages", () => {
    it("drops trailing assistant-only continuation text before provider requests", () => {
      const messages: Message[] = [
        {
          id: "user_1",
          role: "user",
          parts: [{ type: "text", text: "Help me build an agent." }],
        },
        {
          id: "assistant_form",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "I'll ask one setup question.",
            },
            {
              type: "tool-form_input",
              toolCallId: "tool_form",
              toolName: "form_input",
              args: { title: "Agent brief" },
            },
          ],
        },
        {
          id: "tool_form",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "tool_form",
            toolName: "form_input",
            result: { submitted: true, values: { brief: "gmail agent doing morning brief" } },
          }],
        },
        {
          id: "assistant_tools",
          role: "assistant",
          parts: [
            { type: "text", text: "Let me check the Gmail integration." },
            {
              type: "tool-get_integration",
              toolCallId: "tool_integration",
              toolName: "get_integration",
              args: { name: "gmail" },
            },
            {
              type: "tool-list_agents",
              toolCallId: "tool_agents",
              toolName: "list_agents",
              args: { project_reference: "test-661633ea" },
            },
          ],
        },
        {
          id: "tool_integration",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "tool_integration",
            toolName: "get_integration",
            result: { name: "gmail", auth: "oauth" },
          }],
        },
        {
          id: "tool_agents",
          role: "tool",
          parts: [{
            type: "tool-result",
            toolCallId: "tool_agents",
            toolName: "list_agents",
            result: { agents: [] },
          }],
        },
        {
          id: "assistant_prefill",
          role: "assistant",
          parts: [{
            type: "text",
            text: "Let me get the one detail I need to build the right agent for you.",
          }],
        },
      ];

      const historyMessages = convertToTextGenerationRuntimeMessages(messages);
      assertEquals(historyMessages.at(-1)?.role, "assistant");

      const requestMessages = convertToTextGenerationRuntimeRequestMessages(messages);
      assertEquals(requestMessages.at(-1)?.role, "tool");
      assertEquals(requestMessages.length, historyMessages.length - 1);
    });

    it("strips every trailing assistant message, including a split unanswered tool call", () => {
      const messages: Message[] = [
        { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "tool-search", toolCallId: "tc1", toolName: "search", args: { q: "x" } },
            { type: "text", text: "trailing" },
          ],
        },
      ];

      const history = convertToTextGenerationRuntimeMessages(messages);
      assertEquals(
        history.map((m) => m.role),
        ["user", "assistant", "assistant"],
        "an unanswered tool call splits the assistant turn in two",
      );

      assertEquals(
        convertToTextGenerationRuntimeRequestMessages(messages),
        [{ role: "user", content: "hi" }],
        "every trailing assistant message must be stripped so the request never ends on an unanswered tool call",
      );
    });

    it("keeps a trailing assistant whose metadata came from a delivered replay checkpoint", () => {
      const providerMetadata = {
        anthropic: {
          rawAssistantMessages: [[{
            type: "thinking",
            thinking: "",
            signature: "sig-trailing-replay",
          }]],
        },
      };
      const trailing = markProviderReplayDelivered(attachProviderMetadata({
        id: "a-replay",
        role: "assistant",
        parts: [{ type: "reasoning", signature: "sig-trailing-replay" }],
      } as Message, providerMetadata));

      assertEquals(
        convertToTextGenerationRuntimeRequestMessages([
          { id: "u1", role: "user", parts: [{ type: "text", text: "continue" }] },
          trailing,
        ]),
        [{ role: "user", content: "continue" }, {
          role: "assistant",
          content: [{ type: "text", text: "" }],
          providerMetadata,
        }],
      );
    });

    it("still trims a trailing assistant whose metadata was attached during the run", () => {
      const trailing = attachProviderMetadata({
        id: "a-live",
        role: "assistant",
        parts: [{ type: "text", text: "streamed continuation" }],
      } as Message, {
        anthropic: {
          rawAssistantMessages: [[{
            type: "thinking",
            thinking: "",
            signature: "sig-live-turn",
          }]],
        },
      });

      assertEquals(
        convertToTextGenerationRuntimeRequestMessages([
          { id: "u1", role: "user", parts: [{ type: "text", text: "continue" }] },
          trailing,
        ]),
        [{ role: "user", content: "continue" }],
        "live in-run metadata must not turn a resume into an assistant prefill",
      );
    });
  });

  describe("attachment reachability across the conversion entry points", () => {
    // The runtime calls the request entry point, which delegates to the batch
    // one, which delegates to the single-message one. Each hand-off is a place
    // the exemption can be dropped silently, so all three are pinned in both
    // directions rather than only the innermost.
    const loopbackAttachmentMessages = (): Message[] => [
      {
        id: "u-attachment",
        role: "user",
        parts: [
          { type: "text", text: "what is in this image?" },
          {
            type: "file",
            url: "http://localhost:3000/api/chat/upload?id=blob_1",
            mediaType: "image/png",
            filename: "screenshot.png",
            uploadId: "blob_1",
          },
        ],
      } as unknown as Message,
    ];

    const attachmentUrls = (message: TextGenerationRuntimeMessage): string[] => {
      const content = (message as TextGenerationRuntimeUserMessage).content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((part) =>
        part.type === "file" || part.type === "image" ? [part.url] : []
      );
    };

    for (
      const entryPoint of [
        {
          name: "convertToTextGenerationRuntimeMessages",
          convert: convertToTextGenerationRuntimeMessages,
        },
        {
          name: "convertToTextGenerationRuntimeRequestMessages",
          convert: convertToTextGenerationRuntimeRequestMessages,
        },
      ]
    ) {
      it(`${entryPoint.name} forwards the server-local exemption`, () => {
        const messages = entryPoint.convert(loopbackAttachmentMessages(), {
          requireInternetReachableAttachments: false,
        });
        assertEquals(messages.length, 1);
        assertEquals(attachmentUrls(messages[0]!), [
          "http://localhost:3000/api/chat/upload?id=blob_1",
        ]);
      });

      it(`${entryPoint.name} still rejects the attachment by default`, () => {
        const error = assertThrows(
          () => entryPoint.convert(loopbackAttachmentMessages()),
          Error,
        ) as Error;
        assertStringIncludes(error.message, "screenshot.png");
      });
    }
  });
});
