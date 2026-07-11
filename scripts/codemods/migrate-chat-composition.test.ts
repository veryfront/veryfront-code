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
