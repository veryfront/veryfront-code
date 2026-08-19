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
  ChatActions,
  ChatInputAttach,
  ChatInputExport,
  ChatInputField,
  ChatInputModel,
  ChatInputRoot,
  ChatInputSend,
  ChatInputStop,
  ChatInputSubmit,
  ChatInputToolbar,
  ChatInputVoice,
  ChatSidebar,
  Message,
  MessageActionBar,
  MessageFeedback,
  Suggestion,
  Suggestions,
  useChat,
  useChatInput,
} from "veryfront/chat";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "veryfront/ui";
import type {
  DropdownMenuItemProps,
  DropdownMenuTriggerProps,
  PopoverTriggerProps,
} from "veryfront/ui";
import type {
  AgentPickerActionProps,
  AgentPickerSearchProps,
  BranchPickerActionProps,
  BranchPickerCountProps,
  ChatAgentInfo,
  ChatActionsTriggerProps,
  ChatInputActionProps,
  ChatInputAttachProps,
  ChatInputExportProps,
  ChatInputFieldProps,
  ChatInputModelProps,
  ChatInputRootProps,
  ChatInputSendProps,
  ChatInputStopProps,
  ChatInputSubmitProps,
  ChatInputToolbarProps,
  ChatInputVoiceProps,
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

/** Every ChatInput leaf is independently importable with its matching props type. */
export function FlatChatInputDemo(): React.ReactElement {
  return (
    <ChatInputRoot input="ready" onChange={() => {}} onSubmit={() => {}}>
      <ChatInputField />
      <ChatInputToolbar>
        <ChatInputAttach />
        <ChatInputModel />
        <ChatInputExport messages={messages} />
        <ChatInputVoice />
        <ChatInputSend />
        <ChatInputStop />
        <ChatInputSubmit />
      </ChatInputToolbar>
    </ChatInputRoot>
  );
}

/** Headless capability state and getter props agree for published consumers. */
function HeadlessAttachmentControl(): React.ReactElement | null {
  const input = useChatInput();
  return input.canAttach ? <button {...input.getAttachProps()}>Attach</button> : null;
}

void HeadlessAttachmentControl;

const anchorActionRef = React.createRef<HTMLAnchorElement>();
const anchorMenuItemRef = React.createRef<HTMLAnchorElement>();
const anchorTriggerRef = React.createRef<HTMLAnchorElement>();

interface ConsumerMenuItemProps extends DropdownMenuItemProps {
  analyticsId?: string;
}

interface ConsumerChatInputActionProps extends ChatInputActionProps {
  analyticsId?: string;
}

interface ConsumerChatActionsTriggerProps extends ChatActionsTriggerProps {
  analyticsId?: string;
}

interface ConsumerDropdownTriggerProps extends DropdownMenuTriggerProps {
  analyticsId?: string;
}

interface ConsumerPopoverTriggerProps extends PopoverTriggerProps {
  analyticsId?: string;
}

const dynamicAsChild: boolean = messages.length > 0;
const compatibleMenuItemProps: DropdownMenuItemProps = {
  asChild: dynamicAsChild,
  onSelect: () => undefined,
};
const compatibleChatInputActionProps: ChatInputActionProps = {
  asChild: dynamicAsChild,
};
const compatibleChatActionsTriggerProps: ChatActionsTriggerProps = {
  asChild: dynamicAsChild,
};
const compatibleDropdownTriggerProps: DropdownMenuTriggerProps = {
  asChild: dynamicAsChild,
};
const compatiblePopoverTriggerProps: PopoverTriggerProps = {
  asChild: dynamicAsChild,
};

/** Existing wrappers can extend and spread the broad public menu-item contract. */
export function ConsumerMenuItem({
  analyticsId,
  ...props
}: ConsumerMenuItemProps): React.ReactElement {
  return <DropdownMenuItem {...props} data-analytics-id={analyticsId} />;
}

/** Historical public interfaces remain extendable and wrapper-spread compatible. */
export function ConsumerChatInputAction({
  analyticsId,
  ...props
}: ConsumerChatInputActionProps): React.ReactElement | null {
  return <ChatInputSend {...props} data-analytics-id={analyticsId} />;
}

export function ConsumerChatActionsTrigger({
  analyticsId,
  ...props
}: ConsumerChatActionsTriggerProps): React.ReactElement {
  return <ChatActions.Trigger {...props} data-analytics-id={analyticsId} />;
}

export function ConsumerDropdownTrigger({
  analyticsId,
  ...props
}: ConsumerDropdownTriggerProps): React.ReactElement {
  return <DropdownMenuTrigger {...props} data-analytics-id={analyticsId} />;
}

export function ConsumerPopoverTrigger({
  analyticsId,
  ...props
}: ConsumerPopoverTriggerProps): React.ReactElement {
  return <PopoverTrigger {...props} data-analytics-id={analyticsId} />;
}

void compatibleChatInputActionProps;
void compatibleChatActionsTriggerProps;
void compatibleDropdownTriggerProps;
void compatiblePopoverTriggerProps;

/** Slotted action refs describe the element that actually renders. */
export function PolymorphicChatInputActionDemo(): React.ReactElement {
  return (
    <ChatInputRoot input="ready" onChange={() => {}} onSubmit={() => {}}>
      <ChatInputSend
        asChild
        ref={anchorActionRef}
        onClick={(event, next) => {
          event.currentTarget.href;
          next();
        }}
      >
        <a href="#send">Send</a>
      </ChatInputSend>
      <ChatInputStop
        asChild
        ref={anchorActionRef}
        onClick={(event, next) => {
          event.currentTarget.href;
          next();
        }}
      >
        <a href="#stop">Stop</a>
      </ChatInputStop>
      <ChatInputVoice<HTMLAnchorElement>
        asChild
        onClick={(event, next) => {
          event.currentTarget.href;
          next();
        }}
      >
        <a href="#voice">Voice</a>
      </ChatInputVoice>
      <ChatInputSubmit
        asChild
        ref={anchorActionRef}
        onClick={(event, next) => {
          event.currentTarget.href;
          next();
        }}
      >
        <a href="#submit">Submit</a>
      </ChatInputSubmit>
    </ChatInputRoot>
  );
}

/** Slotted menu and ChatActions contracts describe anchor refs and events honestly. */
export function PolymorphicMenuDemo(): React.ReactElement {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild ref={anchorTriggerRef}>
          <a href="#menu">Menu</a>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <ConsumerMenuItem {...compatibleMenuItemProps}>
            <button type="button">Conditional slot</button>
          </ConsumerMenuItem>
          <DropdownMenuItem onSelect={() => undefined}>
            No-argument handler
          </DropdownMenuItem>
          <DropdownMenuItem
            asChild
            ref={anchorMenuItemRef}
            onSelect={(event) => event.currentTarget.focus()}
          >
            <a href="#archive">Archive</a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover>
        <PopoverTrigger asChild ref={anchorTriggerRef}>
          <a href="#popover">Popover</a>
        </PopoverTrigger>
        <PopoverContent>Details</PopoverContent>
      </Popover>
      <ChatActions.Root>
        <ChatActions.Trigger asChild ref={anchorTriggerRef}>
          <a href="#actions">Actions</a>
        </ChatActions.Trigger>
        <ChatActions.Content />
      </ChatActions.Root>
    </>
  );
}

export type ChatInputFlatPartProps = [
  ChatInputAttachProps,
  ChatInputExportProps,
  ChatInputFieldProps,
  ChatInputModelProps,
  ChatInputRootProps,
  ChatInputSendProps,
  ChatInputStopProps,
  ChatInputSubmitProps,
  ChatInputToolbarProps,
  ChatInputVoiceProps,
];

/** Legacy additive-phase shapes remain source compatible for existing consumers. */
export const legacyOwnedRootWithoutSetter: ChatInputRootProps = {
  input: "ready",
  onChange: () => {},
  sendMessage: () => {},
  children: <ChatInputField />,
};

export const legacyMixedSubmitRoot: ChatInputRootProps = {
  input: "ready",
  onChange: () => {},
  onSubmit: () => {},
  sendMessage: () => {},
  setInput: () => {},
  children: <ChatInputField />,
};

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
  children: <span aria-hidden="true">&lt;</span>,
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
