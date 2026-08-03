import { assert, assertEquals, assertMatch, assertStringIncludes } from "#std/assert";
import { parse } from "npm:@babel/parser@7.29.2";
import { migrateChatComposition, parseCliOptions } from "./migrate-chat-composition.ts";

Deno.test("chat composition codemod accepts the deno task separator", () => {
  assertEquals(parseCliOptions(["--", "--check", "./app"]), {
    paths: ["./app"],
    check: true,
    dryRun: false,
  });
});

Deno.test("chat composition codemod leaves unrelated modules unchanged", () => {
  const source = 'import { Button } from "veryfront/ui";\nexport const value = <Button />;\n';
  const result = migrateChatComposition(source);

  assertEquals(result, { code: source, changed: false, warnings: [] });
});

Deno.test("chat composition codemod rewrites removed compatibility imports", () => {
  const source = `
import {
  Attachment,
  ChatComponents,
  ReasoningCard,
  StandaloneMessage as LegacyMessage,
} from "veryfront/chat";
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "AttachmentPill as Attachment");
  assertStringIncludes(result.code, "Chat as ChatComponents");
  assertStringIncludes(result.code, "Reasoning as ReasoningCard");
  assertStringIncludes(result.code, "Message as LegacyMessage");
});

Deno.test("chat composition codemod supports the public React barrel", () => {
  const source = `
import { ChatComponents, ReasoningCard, useChat } from "veryfront/react";
export function Example() {
  const chat = useChat();
  chat.onSubmit();
  return <ChatComponents {...chat} className="surface" />;
}
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "Chat as ChatComponents");
  assertStringIncludes(result.code, "Reasoning as ReasoningCard");
  assertStringIncludes(result.code, "chat.handleSubmit()");
  assertStringIncludes(result.code, '<ChatComponents chat={chat} className="surface" />');
});

Deno.test("chat composition codemod supports the public chat component subpath", () => {
  const source = `
import { ToolCallCard } from "veryfront/react/components/chat";
export const Example = ({ tool }) => <ToolCallCard tool={tool} />;
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "ToolCall as ToolCallCard");
});

Deno.test("chat composition codemod rewrites useChat aliases from the agent entrypoint", () => {
  const source = `
import { useChat } from "veryfront/agent/react";
export function Example() {
  const chat = useChat();
  chat.onChange({});
  chat.onModelChange("model-id");
}
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "chat.handleInputChange({})");
  assertStringIncludes(result.code, 'chat.setModel("model-id")');
});

Deno.test("chat composition codemod converts a spread useChat result", () => {
  const source = `
import { Chat, useChat } from "veryfront/chat";
export function Example() {
  const chat = useChat();
  return <Chat {...chat} />;
}
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "<Chat chat={chat} />");
  assertEquals(result.warnings, []);
});

Deno.test("chat composition codemod preserves props beside a useChat spread", () => {
  const source = `
import { Chat, useChat } from "veryfront/chat";
export function Example() {
  const chat = useChat();
  return <Chat {...chat} placeholder="Ask Veryfront" />;
}
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, '<Chat chat={chat} placeholder="Ask Veryfront" />');
  assertEquals(result.warnings, []);
});

Deno.test("chat composition codemod removes a duplicate spread of the explicit session", () => {
  const source = `
import { Chat, useChat } from "veryfront/chat";
export function Example() {
  const chat = useChat();
  return <Chat chat={chat} {...chat} />;
}
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "<Chat chat={chat} />");
  assert(!result.code.includes("{...chat}"));
  assertEquals(result.warnings, []);
});

Deno.test("chat composition codemod retains a spread from a different session", () => {
  const source = `
import { Chat, useChat } from "veryfront/chat";
export function Example() {
  const primary = useChat();
  const secondary = useChat();
  return <Chat chat={primary} {...secondary} />;
}
`;
  const result = migrateChatComposition(source);
  const second = migrateChatComposition(result.code);

  assert(result.changed);
  assertStringIncludes(result.code, "chat={primary}");
  assertStringIncludes(result.code, "{...secondary}");
  assertStringIncludes(result.code, "TODO(veryfront-migration)");
  assertStringIncludes(
    result.code,
    "https://github.com/veryfront/veryfront-code/blob/main/scripts/codemods/README.md",
  );
  assert(!result.code.includes("/docs/plans/"));
  assertEquals(result.warnings, [
    "A Chat element uses different useChat results for chat and a spread.",
  ]);
  assert(second.changed);
  assertEquals(
    second.code.match(/TODO\(veryfront-migration\)/g)?.length,
    1,
  );
});

Deno.test("chat composition codemod retains different session spreads on the first pass", () => {
  const source = `
import { Chat, useChat } from "veryfront/chat";
export function Example() {
  const primary = useChat();
  const secondary = useChat();
  return <Chat {...primary} {...secondary} />;
}
`;
  const result = migrateChatComposition(source);
  const second = migrateChatComposition(result.code);

  assert(result.changed);
  assert(!result.code.includes("chat={"));
  assertStringIncludes(result.code, "{...primary}");
  assertStringIncludes(result.code, "{...secondary}");
  assertStringIncludes(result.code, "TODO(veryfront-migration)");
  assertEquals(result.warnings, [
    "A Chat element spreads different useChat results.",
  ]);
  assert(second.changed);
  assertEquals(
    second.code.match(/TODO\(veryfront-migration\)/g)?.length,
    1,
  );
});

Deno.test("chat composition codemod collapses repeated spreads of one session", () => {
  const source = `
import { Chat, useChat } from "veryfront/chat";
export function Example() {
  const chat = useChat();
  return <Chat {...chat} {...chat} />;
}
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "<Chat chat={chat} />");
  assert(!result.code.includes("{...chat}"));
  assertEquals(result.warnings, []);
});

Deno.test("chat composition codemod retains mixed proven and unknown spreads", () => {
  const source = `
import { Chat, useChat } from "veryfront/chat";
export function Example(props: object) {
  const chat = useChat();
  return <Chat {...props} {...chat} />;
}
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assert(!result.code.includes("chat={"));
  assertStringIncludes(result.code, "{...props}");
  assertStringIncludes(result.code, "{...chat}");
  assertStringIncludes(result.code, "TODO(veryfront-migration)");
  assertEquals(result.warnings, [
    "A Chat element mixes a useChat result with another spread.",
  ]);
});

Deno.test("chat composition codemod does not infer a session beside spread props", () => {
  const elements = [
    "<Chat {...props} messages={chat.messages} input={chat.input} />",
    "<Chat messages={chat.messages} input={chat.input} {...props} />",
  ];

  for (const element of elements) {
    const source = `
import { Chat } from "veryfront/chat";
export const Example = ({ chat, props }) => ${element};
`;
    const result = migrateChatComposition(source);
    const second = migrateChatComposition(result.code);

    assert(result.changed);
    assert(!result.code.includes("chat={chat}"));
    assertStringIncludes(result.code, "messages={chat.messages}");
    assertStringIncludes(result.code, "input={chat.input}");
    assertStringIncludes(result.code, "{...props}");
    assertStringIncludes(result.code, "TODO(veryfront-migration)");
    assertEquals(result.warnings, [
      "A Chat session cannot be inferred safely beside spread props.",
    ]);
    assert(second.changed);
    assertEquals(
      second.code.match(/TODO\(veryfront-migration\)/g)?.length,
      1,
    );
  }
});

Deno.test("chat composition codemod marks unmatched flat props beside a session", () => {
  const source = `
import { Chat, useChat } from "veryfront/chat";
export function Example({ submit }) {
  const chat = useChat();
  return <Chat {...chat} onSubmit={submit} />;
}
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "chat={chat}");
  assertStringIncludes(result.code, "onSubmit={submit}");
  assertStringIncludes(result.code, "TODO(veryfront-migration)");
  assertEquals(result.warnings.length, 1);
});

Deno.test("chat composition codemod cleans flat props beside explicit chat", () => {
  const source = `
import { Chat } from "veryfront/chat";
export const Example = ({ chat, submit }) => (
  <Chat chat={chat} messages={chat.messages} onSubmit={submit} />
);
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assert(!result.code.includes("messages={chat.messages}"));
  assertStringIncludes(result.code, "onSubmit={submit}");
  assertStringIncludes(result.code, "TODO(veryfront-migration)");
  assertEquals(result.warnings.length, 1);
});

Deno.test("chat composition codemod retains flat props beside an explicit session and spread", () => {
  const elements = [
    "<Chat chat={chat} {...props} messages={chat.messages} />",
    "<Chat messages={chat.messages} {...props} chat={chat} />",
  ];

  for (const element of elements) {
    const source = `
import { Chat } from "veryfront/chat";
export const Example = ({ chat, props }) => ${element};
`;
    const result = migrateChatComposition(source);
    const second = migrateChatComposition(result.code);

    assert(result.changed);
    assertStringIncludes(result.code, "chat={chat}");
    assertStringIncludes(result.code, "messages={chat.messages}");
    assertStringIncludes(result.code, "{...props}");
    assertStringIncludes(result.code, "TODO(veryfront-migration)");
    assertEquals(result.warnings, [
      "Flat Chat props beside an explicit session and spread require manual migration.",
    ]);
    assert(second.changed);
    assertEquals(
      second.code.match(/TODO\(veryfront-migration\)/g)?.length,
      1,
    );
  }
});

Deno.test("chat composition codemod leaves an unproven Chat spread unchanged", () => {
  const source = `
import { Chat } from "veryfront/chat";
export const Example = ({ props }) => <Chat {...props} />;
`;
  const result = migrateChatComposition(source);

  assertEquals(result, { code: source, changed: false, warnings: [] });
});

Deno.test("chat composition codemod rewrites removed useChat aliases", () => {
  const source = `
import { useChat } from "veryfront/chat";
export function Example(event) {
  const chat = useChat();
  const { onSubmit: submit, onChange } = useChat();
  chat.onChange(event);
  chat.onSubmit();
  chat.onModelChange("model-id");
  return { submit, onChange };
}
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "handleSubmit: submit");
  assertStringIncludes(result.code, "handleInputChange: onChange");
  assertStringIncludes(result.code, "chat.handleInputChange(event)");
  assertStringIncludes(result.code, "chat.handleSubmit()");
  assertStringIncludes(result.code, 'chat.setModel("model-id")');
});

Deno.test("chat composition codemod rewrites Chat.Composer to Chat.Input", () => {
  const source = `
import { Chat } from "veryfront/chat";
export const Example = () => (
  <Chat.Composer input="" onChange={() => {}} onSubmit={() => {}}>
    <span>Actions</span>
  </Chat.Composer>
);
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "<Chat.Input");
  assertStringIncludes(result.code, "</Chat.Input>");
  assert(!result.code.includes("Chat.Composer"));
});

Deno.test("chat composition codemod folds matching session members into chat", () => {
  const source = `
import { Chat } from "veryfront/chat";
export const Example = ({ chat }) => (
  <Chat
    messages={chat.messages}
    input={chat.input}
    onChange={chat.handleInputChange}
    onSubmit={chat.handleSubmit}
    className="surface"
  />
);
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "chat={chat}");
  assertStringIncludes(result.code, 'className="surface"');
  assert(!result.code.includes("messages={chat.messages}"));
  assert(!result.code.includes("onSubmit={chat.handleSubmit}"));
  assertEquals(result.warnings, []);
});

Deno.test("chat composition codemod removes default toggles and marks manual variants", () => {
  const source = `
import { Message } from "veryfront/chat";
export const DefaultMessage = ({ message }) => <Message message={message} showSources />;
export const CustomMessage = ({ message }) => <Message message={message} showSources={false} />;
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assert(!result.code.includes("showSources />"));
  assertStringIncludes(result.code, "showSources={false}");
  assertStringIncludes(result.code, "TODO(veryfront-migration)");
  assertStringIncludes(result.code, "presence-driven compound children");
  assertEquals(result.warnings.length, 1);
});

Deno.test("chat composition codemod retains feature toggles beside spread props", () => {
  const elements = [
    "<Message {...props} showSources />",
    "<Message showSources {...props} />",
  ];

  for (const element of elements) {
    const source = `
import { Message } from "veryfront/chat";
export const Example = ({ props }) => ${element};
`;
    const result = migrateChatComposition(source);
    const second = migrateChatComposition(result.code);

    assert(result.changed);
    assertStringIncludes(result.code, "showSources");
    assertStringIncludes(result.code, "{...props}");
    assertStringIncludes(result.code, "TODO(veryfront-migration)");
    assertEquals(result.warnings, [
      "Presence-driven props on Message require manual migration beside a spread: showSources.",
    ]);
    assert(second.changed);
    assertEquals(
      second.code.match(/TODO\(veryfront-migration\)/g)?.length,
      1,
    );
  }
});

Deno.test("chat composition codemod uses the fixed Message.Content step behavior", () => {
  const source = `
import { Message } from "veryfront/chat";
export const Defaults = ({ message }) => (
  <Message.Root message={message}>
    <Message.Content showSteps />
  </Message.Root>
);
export const Hidden = ({ message }) => (
  <Message.Root message={message}>
    <Message.Content showSteps={false} />
  </Message.Root>
);
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assert(!result.code.includes("<Message.Content showSteps />"));
  assertStringIncludes(result.code, "showSteps={false}");
  assertEquals(result.warnings.length, 1);
});

Deno.test("chat composition codemod retains TODOs across mixed rewrites", () => {
  const source = `
import { Chat } from "veryfront/chat";
export const Example = () => (
  <Chat showSources messages={[]} input="" />
);
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assert(!result.code.includes("showSources"));
  assertStringIncludes(result.code, "messages={[]}");
  assertStringIncludes(result.code, "TODO(veryfront-migration)");
  assertEquals(result.warnings.length, 1);
});

Deno.test("chat composition codemod leaves unsafe props visible with a migration marker", () => {
  const source = `
import { Chat, InlineCitation } from "veryfront/chat";
export const Example = ({ renderTool }) => (
  <>
    <Chat messages={[]} input="" renderTool={renderTool} />
    <InlineCitation cardClassName="citation" />
  </>
);
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertMatch(
    result.code,
    /TODO\(veryfront-migration\)[\s\S]*flat Chat session props/,
  );
  assertStringIncludes(result.code, "Move renderTool logic");
  assertStringIncludes(result.code, "Move removed icon and class-name bags");
  assert(!result.code.includes("> /* TODO(veryfront-migration)"));
  parse(result.code, { sourceType: "module", plugins: ["typescript", "jsx"] });
  assert(result.warnings.length >= 3);
});

Deno.test("chat composition codemod adapts Sources.renderPill to renderItem", () => {
  const source = `
import { Sources } from "veryfront/chat";
export const Example = ({ sources, renderSource }) => (
  <Sources sources={sources} renderPill={renderSource} />
);
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "renderItem={({");
  assertStringIncludes(result.code, "item,");
  assertStringIncludes(result.code, "index");
  assertStringIncludes(result.code, "renderSource(item, index)");
  assert(!result.code.includes("renderPill"));
  assertEquals(result.warnings, []);
});

Deno.test("chat composition codemod leaves unstable render callbacks for manual migration", () => {
  const cases = [
    "factory()",
    "renderer.render",
    "(source, index) => renderer.render(source, index)",
    "globalRenderer",
  ];

  for (const expression of cases) {
    const source = `
import { Sources } from "veryfront/chat";
export const Example = ({ factory, renderer }) => (
  <Sources renderPill={${expression}} />
);
`;
    const result = migrateChatComposition(source);
    const second = migrateChatComposition(result.code);

    assert(result.changed);
    assertStringIncludes(result.code, "renderPill={");
    assert(!result.code.includes("renderItem={"));
    assertStringIncludes(result.code, "TODO(veryfront-migration)");
    assertEquals(result.warnings, [
      "Manual render-prop migration required: renderPill.",
    ]);
    assert(second.changed);
    assertEquals(
      second.code.match(/TODO\(veryfront-migration\)/g)?.length,
      1,
    );
  }
});

Deno.test("chat composition codemod leaves a reassigned render callback for manual migration", () => {
  const source = `
import { Sources } from "veryfront/chat";
export function Example(first, second) {
  let renderPill = first;
  const element = <Sources renderPill={renderPill} />;
  renderPill = second;
  return element;
}
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "renderPill={renderPill}");
  assert(!result.code.includes("renderItem={"));
  assertStringIncludes(result.code, "TODO(veryfront-migration)");
  assertEquals(result.warnings, [
    "Manual render-prop migration required: renderPill.",
  ]);
});

Deno.test("chat composition codemod retains adaptable render props beside a spread", () => {
  const elements = [
    "<Sources {...props} renderPill={renderPill} />",
    "<Sources renderPill={renderPill} {...props} />",
  ];

  for (const element of elements) {
    const source = `
import { Sources } from "veryfront/chat";
export const Example = ({ props, renderPill }) => ${element};
`;
    const result = migrateChatComposition(source);
    const second = migrateChatComposition(result.code);

    assert(result.changed);
    assertStringIncludes(result.code, "renderPill={renderPill}");
    assert(!result.code.includes("renderItem={"));
    assertStringIncludes(result.code, "{...props}");
    assertStringIncludes(result.code, "TODO(veryfront-migration)");
    assertEquals(result.warnings, [
      "A render prop on Sources requires manual migration beside a spread: renderPill.",
    ]);
    assert(second.changed);
    assertEquals(
      second.code.match(/TODO\(veryfront-migration\)/g)?.length,
      1,
    );
  }
});

Deno.test("chat composition codemod adapts Message.Tokens.renderRow", () => {
  const source = `
import { Message } from "veryfront/chat";
export const Example = ({ renderToken }) => (
  <Message.Root message={{}}>
    <Message.Tokens renderRow={renderToken} />
  </Message.Root>
);
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "renderItem={({");
  assertStringIncludes(result.code, "renderToken(item)");
  assert(!result.code.includes("renderRow"));
  assertEquals(result.warnings, []);
});

Deno.test("chat composition codemod handles Chat.Message nested compounds", () => {
  const source = `
import { Chat } from "veryfront/chat";
export const Example = ({ renderTool, renderToken }) => (
  <>
    <Chat.Message.Content showSources renderTool={renderTool} />
    <Chat.Message.Part showSteps renderTool={renderTool} />
    <Chat.Message.Tokens renderRow={renderToken} />
    <Chat.MessageList.Content showSources />
  </>
);
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "<Chat.Message.Content");
  assertStringIncludes(result.code, "showSources");
  assertStringIncludes(result.code, "renderTool={renderTool}");
  assertStringIncludes(result.code, "<Chat.Message.Part");
  assert(!result.code.includes("showSteps"));
  assertStringIncludes(result.code, "<Chat.Message.Tokens renderItem={({");
  assertStringIncludes(result.code, "renderToken(item)");
  assertStringIncludes(result.code, "<Chat.MessageList.Content showSources />");
  assertStringIncludes(result.code, "TODO(veryfront-migration)");
  assertEquals(result.warnings.length, 3);
});

Deno.test("chat composition codemod does not rewrite a shadowed chat binding", () => {
  const source = `
import { useChat } from "veryfront/chat";
export function Example() {
  const chat = useChat();
  function unrelated(chat: { onSubmit: () => void }) {
    chat.onSubmit();
  }
  chat.onSubmit();
  return unrelated;
}
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "chat.handleSubmit();");
  assertStringIncludes(result.code, "chat.onSubmit();");
});

Deno.test("chat composition codemod leaves a reassigned useChat result for manual migration", () => {
  const source = `
import { useChat } from "veryfront/chat";
export function Example(other: { onSubmit: () => void }) {
  let chat = useChat();
  chat.onSubmit();
  chat = other;
  chat.onSubmit();
}
`;
  const result = migrateChatComposition(source);
  const second = migrateChatComposition(result.code);

  assert(result.changed);
  assert(!result.code.includes("handleSubmit"));
  assertEquals(result.code.match(/chat\.onSubmit\(\)/g)?.length, 2);
  assertStringIncludes(result.code, "TODO(veryfront-migration)");
  assertEquals(result.warnings, [
    "A reassigned useChat result requires manual migration: chat.",
  ]);
  assert(second.changed);
  assertEquals(
    second.code.match(/TODO\(veryfront-migration\)/g)?.length,
    1,
  );
});

Deno.test("chat composition codemod ignores a shadowed useChat function", () => {
  const source = `
import { useChat } from "veryfront/chat";
export function Example(useChat: () => { onSubmit: () => void }) {
  const chat = useChat();
  chat.onSubmit();
}
`;

  assertEquals(migrateChatComposition(source), {
    code: source,
    changed: false,
    warnings: [],
  });
});

Deno.test("chat composition codemod ignores a shadowed Chat component", () => {
  const source = `
import { Chat } from "veryfront/chat";
export function Example({ Chat }: { Chat: (props: object) => unknown }) {
  return <Chat showScrollButton={false} />;
}
`;

  assertEquals(migrateChatComposition(source), {
    code: source,
    changed: false,
    warnings: [],
  });
});

Deno.test("chat composition codemod keeps aliased import bindings supported", () => {
  const source = `
import { Chat as ChatSurface, useChat as useSession } from "veryfront/chat";
export function Example() {
  const session = useSession();
  return <ChatSurface {...session} />;
}
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "<ChatSurface chat={session} />");
});

Deno.test("chat composition codemod rewrites destructured aliases and defaults", () => {
  const source = `
import { useChat as useSession } from "veryfront/chat";
export function Example() {
  const { onSubmit: submit = () => {}, onChange } = useSession();
  return { submit, onChange };
}
`;
  const result = migrateChatComposition(source);

  assert(result.changed);
  assertStringIncludes(result.code, "handleSubmit: submit = () => {}");
  assertStringIncludes(result.code, "handleInputChange: onChange");
});

Deno.test("chat composition codemod keeps removed leaf props visible in check mode", () => {
  const source = `
import { AgentPicker, ChatInput, ModelSelector } from "veryfront/chat";
export const Example = ({ messages, onExport }) => (
  <>
    <ChatInput
      input=""
      onChange={() => {}}
      showExport={false}
      messages={messages}
      onExportClick={onExport}
    />
    <AgentPicker.Content showSearch={false} searchPlaceholder="Find an agent" />
    <ModelSelector.Content showSearch={false} searchPlaceholder="Find a model" />
  </>
);
`;
  const first = migrateChatComposition(source);
  const second = migrateChatComposition(first.code);

  assert(first.changed);
  assert(second.changed);
  assertStringIncludes(second.code, "messages={messages}");
  assertStringIncludes(second.code, "onExportClick={onExport}");
  assertStringIncludes(second.code, 'searchPlaceholder="Find an agent"');
  assertStringIncludes(second.code, 'searchPlaceholder="Find a model"');
  assertStringIncludes(second.code, "TODO(veryfront-migration)");
  assert(second.warnings.length >= 3);
});
