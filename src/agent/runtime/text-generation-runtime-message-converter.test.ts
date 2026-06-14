import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  convertToTextGenerationRuntimeMessage,
  convertToTextGenerationRuntimeMessages,
} from "./text-generation-runtime-message-converter.ts";
import type {
  TextGenerationRuntimeAssistantMessage,
  TextGenerationRuntimeToolMessage,
  TextGenerationRuntimeUserMessage,
} from "./text-generation-runtime-message-types.ts";
import type { Message } from "../types.ts";

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
});
