import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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

  // `Object.assign(ChatBase, { Message, ErrorBanner })` — shorthand keys are
  // real sub-parts, and missing them made honest anatomy read as a lie.
  it("collects shorthand properties as sub-parts", () => {
    const compounds = collectCompoundParts([{
      path: "chat-preset.tsx",
      content: `
        export const Chat: ChatComponent = Object.assign(ChatBase, {
          Root: ChatRoot,
          Message,
          ErrorBanner,
        });
      `,
    }]);

    assertEquals(compounds.get("Chat"), new Set(["Root", "Message", "ErrorBanner"]));
  });

  // Only the compound's OWN properties are its anatomy. A key one level deeper
  // belongs to that inner object, and treating it as a direct part would let
  // `Chat.Message` through on a compound that has no `Message`.
  it("ignores keys nested inside a further object literal", () => {
    const source = [{
      path: "nested.tsx",
      content: `
        export const Chat = Object.assign(ChatBase, {
          Root: ChatRoot,
          config: { Message, Inner: InnerThing },
        });
      `,
    }];
    const compounds = collectCompoundParts(source);

    assertEquals(compounds.get("Chat"), new Set(["Root", "config"]));
    assertEquals(
      findCompositionLies(
        [{ path: "chat.stories.tsx", content: "const compositionTree = `<Chat.Message />`;" }],
        compounds,
      ),
      [{ path: "chat.stories.tsx", token: "Chat.Message" }],
    );
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
