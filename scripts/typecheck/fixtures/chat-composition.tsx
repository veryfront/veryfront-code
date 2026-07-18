// Consumer fixture — documented `veryfront/chat` composition.
//
// Never executed. It exists so the consumer `tsc --noEmit` gate
// (scripts/typecheck/tsconfig.consumer.json) proves the public chat
// surface — batteries `<Chat>` AND the `<Chat.Root>` compound — composes under
// React-19 `@types/react` the way an external app imports it (via the built
// npm `.d.ts`, exactly what npm consumers get). This is the check `deno check`
// cannot perform.
import * as React from "react";
import {
  AgentPicker,
  BranchPicker,
  Chat,
  ChatSidebar,
  Message,
  MessageActionBar,
  MessageFeedback,
  Suggestion,
  Suggestions,
  useChat,
} from "veryfront/chat";
import type {
  AgentPickerActionProps,
  AgentPickerSearchProps,
  BranchPickerActionProps,
  BranchPickerCountProps,
  ChatAgentInfo,
  ChatMessage,
  MessageActionBarActionProps,
  MessageFeedbackActionProps,
  MessageTokensProps,
  TokenRowProps,
} from "veryfront/chat";

const messages: ChatMessage[] = [];
const agent: ChatAgentInfo = {
  name: "Support agent",
  description: "Answers product questions.",
};

/** Batteries — the default explicit variant, zero-config. */
export function BatteriesDemo(): React.ReactElement {
  const chat = useChat();
  return <Chat chat={chat} agent={agent} />;
}

/** Compound — arrange the blocks yourself; each leaf individually addressable. */
export function ComposedDemo(): React.ReactElement {
  return (
    <Chat.Root messages={messages} input="">
      <Chat.Empty title="Ask anything">
        <Suggestions>
          <Suggestion suggestion="Summarize this page" />
        </Suggestions>
      </Chat.Empty>
      <Chat.MessageList messages={messages} />
      <Chat.Input input="" onChange={() => {}} placeholder="Ask Veryfront" />
    </Chat.Root>
  );
}

/** A standalone message leaf renders off a single ChatMessage. */
export function MessageDemo({ message }: { message: ChatMessage }): React.ReactElement {
  return <Message message={message} />;
}

/** Sidebar compound. */
export function SidebarDemo(): React.ReactElement {
  return <ChatSidebar conversations={[]} />;
}

const pickerActionProps: AgentPickerActionProps = {
  icon: <span aria-hidden="true">+</span>,
  className: "picker-action",
};
const pickerSearchProps: AgentPickerSearchProps = { className: "picker-search" };
const branchActionProps: BranchPickerActionProps = {
  icon: <span aria-hidden="true">&lt;</span>,
  className: "branch-action",
};
const branchCountProps: BranchPickerCountProps = { className: "branch-count" };
const messageActionProps: MessageActionBarActionProps = {
  icon: <span aria-hidden="true">C</span>,
  className: "message-action",
};
const feedbackActionProps: MessageFeedbackActionProps = {
  icon: <span aria-hidden="true">Y</span>,
  className: "feedback-action",
};

/** Addressable action leaves accept one icon prop each. */
export function IconLeavesDemo(): React.ReactElement {
  return (
    <>
      <AgentPicker agents={[]} onCreate={() => {}} onManage={() => {}}>
        <AgentPicker.Trigger />
        <AgentPicker.Content>
          <AgentPicker.Search {...pickerSearchProps} />
          <AgentPicker.List>
            <AgentPicker.Create {...pickerActionProps} />
            <AgentPicker.Manage {...pickerActionProps} />
          </AgentPicker.List>
        </AgentPicker.Content>
      </AgentPicker>
      <BranchPicker current={1} total={2} onPrev={() => {}} onNext={() => {}}>
        <BranchPicker.Previous {...branchActionProps} />
        <BranchPicker.Count {...branchCountProps} />
        <BranchPicker.Next {...branchActionProps} />
      </BranchPicker>
      <MessageActionBar content="Answer" onRegenerate={() => {}} onEdit={() => {}}>
        <MessageActionBar.Copy {...messageActionProps} />
        <MessageActionBar.Copied {...messageActionProps} />
        <MessageActionBar.Regenerate {...messageActionProps} />
        <MessageActionBar.Edit {...messageActionProps} />
      </MessageActionBar>
      <MessageFeedback messageId="message-1" onFeedback={() => {}}>
        <MessageFeedback.Positive {...feedbackActionProps} />
        <MessageFeedback.Negative {...feedbackActionProps} />
      </MessageFeedback>
    </>
  );
}

function ConsumerTokenRow({ label, value }: TokenRowProps): React.ReactElement {
  return <span>{label}: {value}</span>;
}

const messageTokensProps: MessageTokensProps = {
  renderItem: ({ item }) => <ConsumerTokenRow {...item} />,
};

/** Message token rows use the canonical item renderer contract. */
export function MessageTokensDemo({ message }: { message: ChatMessage }): React.ReactElement {
  return (
    <Message.Root message={message}>
      <Message.Tokens {...messageTokensProps} />
    </Message.Root>
  );
}
