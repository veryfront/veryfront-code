import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import {
  ChatComposer,
  ChatEmpty,
  ChatMessageList,
  ChatRoot,
  ErrorBanner,
  Message,
} from "veryfront/chat";
import type { ChatMessage } from "veryfront/chat";
import {
  chatMessages,
  createChangeHandler,
  modelOptions,
  quickActions,
} from "../fixtures/chat";

const meta = {
  title: "Veryfront UI/Chat/Composition",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function CompositionCanvas({
  initialMessages = chatMessages,
  error,
}: {
  initialMessages?: ChatMessage[];
  error?: Error;
}): React.ReactElement {
  const [messages, setMessages] = React.useState(initialMessages);
  const [input, setInput] = React.useState("Use the composition API");
  const [model, setModel] = React.useState(modelOptions[0]?.value);

  const submit = React.useCallback((event?: React.FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      {
        id: `composition-${current.length + 1}`,
        role: "user",
        parts: [{ type: "text", text }],
      },
    ]);
    setInput("");
  }, [input]);

  return (
    <div className="vf-story-canvas">
      <div className="vf-chat-panel">
        <ChatRoot
          messages={messages}
          input={input}
          setInput={setInput}
          onSubmit={submit}
          onReload={() => setMessages(initialMessages)}
          error={error ?? null}
          models={modelOptions}
          model={model}
          onModelChange={setModel}
          showSources
        >
          {messages.length === 0
            ? (
              <ChatEmpty
                title="Start a composed chat"
                description="This story assembles the exported building blocks."
                quickActions={quickActions}
                onQuickAction={(action) =>
                  setInput(action.prompt ?? action.label)}
              />
            )
            : (
              <ChatMessageList
                messages={messages}
                model={model}
                showSources
                showSteps
                showScrollButton
                onFeedback={() => undefined}
              />
            )}
          {error && (
            <ErrorBanner
              error={error}
              onRetry={() => setMessages(initialMessages)}
            />
          )}
          <ChatComposer
            input={input}
            onChange={createChangeHandler(setInput)}
            onSubmit={submit}
            models={modelOptions}
            model={model}
            onModelChange={setModel}
            showExport
            messages={messages}
          />
        </ChatRoot>
      </div>
    </div>
  );
}

export const AssembledChat: Story = {
  render: () => <CompositionCanvas />,
};

export const EmptyComposition: Story = {
  render: () => <CompositionCanvas initialMessages={[]} />,
};

export const ErrorComposition: Story = {
  render: () => (
    <CompositionCanvas error={new Error("The composed request failed.")} />
  ),
};

export const MessageCompound: Story = {
  render: () => (
    <div className="vf-story-canvas">
      <div className="mx-auto max-w-2xl space-y-6">
        {chatMessages.slice(0, 2).map((message) => (
          <Message.Root
            key={message.id}
            message={message}
            onFeedback={() => undefined}
            getBranches={() => ({ current: 1, total: 3 })}
            switchBranch={() => undefined}
          >
            <Message.Avatar />
            <div className="min-w-0 flex-1">
              <Message.BranchPicker />
              <Message.Content showSources showSteps />
              <Message.Actions />
              <Message.Feedback />
            </div>
          </Message.Root>
        ))}
      </div>
    </div>
  ),
};
