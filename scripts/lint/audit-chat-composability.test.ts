import { assertEquals } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { collectCompoundParts, findCompositionLies } from "./audit-chat-composability.ts";

const SOURCE = [{
  path: "tool-ui.tsx",
  content: `
    export const ToolCall = Object.assign(ToolCallRoot, {
      Root: ToolCallRoot,
      Trigger: ToolCallTrigger,
      Body: ToolCallBody,
    });
  `,
}];

describe("audit-chat-composability", () => {
  it("collects sub-part names from an Object.assign compound", () => {
    const compounds = collectCompoundParts(SOURCE);
    assertEquals(compounds.has("ToolCall"), true);
    const parts = compounds.get("ToolCall")!;
    assertEquals(parts.has("Root"), true);
    assertEquals(parts.has("Trigger"), true);
    assertEquals(parts.has("Body"), true);
  });

  it("collects a compound with an explicit type annotation", () => {
    const compounds = collectCompoundParts([{
      path: "chat.tsx",
      content: `
        export const Chat: ChatComponent = Object.assign(ChatBase, {
          Root: ChatRoot,
          Input: ChatInput,
        });
      `,
    }]);

    assertEquals(compounds.get("Chat"), new Set(["Root", "Input"]));
  });

  it("flags a tree token that is not a real sub-part", () => {
    const compounds = collectCompoundParts(SOURCE);
    const stories = [{
      path: "ToolCall.stories.tsx",
      content: "const compositionTree = `ToolCall\n  +-- ToolCall.Parameters <- fake`;",
    }];
    const lies = findCompositionLies(stories, compounds);
    assertEquals(lies.length, 1);
    assertEquals(lies[0].token, "ToolCall.Parameters");
  });

  it("passes a tree that only names real sub-parts", () => {
    const compounds = collectCompoundParts(SOURCE);
    const stories = [{
      path: "ToolCall.stories.tsx",
      content: "const compositionTree = `ToolCall\n  +-- ToolCall.Trigger\n  +-- ToolCall.Body`;",
    }];
    assertEquals(findCompositionLies(stories, compounds).length, 0);
  });

  it("ignores tokens whose base is not a known compound", () => {
    const compounds = collectCompoundParts(SOURCE);
    const stories = [{
      path: "x.stories.tsx",
      content: "const compositionTree = `Widget.Thing <- not a chat compound`;",
    }];
    assertEquals(findCompositionLies(stories, compounds).length, 0);
  });
});
