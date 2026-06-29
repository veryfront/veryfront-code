import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { Chat } from "veryfront/chat";
import type { ChatMessage } from "veryfront/chat";
import {
  attachments,
  chatMessages,
  createChangeHandler,
  loadingMessages,
  modelOptions,
  quickActions,
} from "../fixtures/chat";

const meta = {
  title: "Veryfront UI/Chat/Preset",
  component: Chat,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof Chat>;

export default meta;
type Story = StoryObj<typeof meta>;

type ChatReviewProps = {
  initialMessages?: ChatMessage[];
  initialInput?: string;
  isLoading?: boolean;
  error?: Error | null;
  showSources?: boolean;
  showSteps?: boolean;
  withModels?: boolean;
  withAttachments?: boolean;
};

function ChatReview({
  initialMessages = chatMessages,
  initialInput = "Can you turn this into a release checklist?",
  isLoading = false,
  error = null,
  showSources = true,
  showSteps = true,
  withModels = false,
  withAttachments = false,
}: ChatReviewProps): React.ReactElement {
  const [messages, setMessages] = React.useState<ChatMessage[]>(
    initialMessages,
  );
  const [input, setInput] = React.useState(initialInput);
  const [model, setModel] = React.useState(modelOptions[0]?.value);

  const submitMessage = React.useCallback((event?: React.FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text) return;

    setMessages((current) => [
      ...current,
      {
        id: `story-user-${current.length + 1}`,
        role: "user",
        createdAt: new Date().toISOString(),
        parts: [{ type: "text", text }],
      },
    ]);
    setInput("");
  }, [input]);

  return (
    <div className="vf-story-canvas">
      <div className="vf-chat-panel">
        <Chat
          messages={messages}
          input={input}
          onChange={createChangeHandler(setInput)}
          onSubmit={submitMessage}
          reload={() => setMessages(initialMessages)}
          stop={() => undefined}
          setInput={setInput}
          isLoading={isLoading}
          error={error}
          placeholder="Ask Veryfront"
          showSources={showSources}
          showSteps={showSteps}
          showScrollButton
          showExport
          models={withModels ? modelOptions : undefined}
          model={withModels ? model : undefined}
          activeModel={withModels ? model : undefined}
          onModelChange={setModel}
          attachments={withAttachments ? attachments : undefined}
          onRemoveAttachment={() => undefined}
          quickActions={quickActions}
          onQuickAction={(action) => setInput(action.prompt ?? action.label)}
          suggestions={[
            "Show risky assumptions",
            "Draft a test plan",
            "Summarize the run",
          ]}
          onSuggestionClick={setInput}
        />
      </div>
    </div>
  );
}

export const Conversation: Story = {
  render: () => <ChatReview />,
};

export const Empty: Story = {
  render: () => (
    <ChatReview
      initialMessages={[]}
      initialInput=""
      showSources={false}
      showSteps={false}
      withModels
    />
  ),
};

export const Loading: Story = {
  render: () => <ChatReview initialMessages={loadingMessages} isLoading />,
};

export const ErrorState: Story = {
  name: "Error",
  render: () => (
    <ChatReview
      error={new Error("The hosted agent returned a recoverable stream error.")}
      withModels
    />
  ),
};

export const ToolAndSources: Story = {
  render: () => <ChatReview showSources showSteps />,
};

export const ModelsAndAttachments: Story = {
  render: () => (
    <ChatReview withModels withAttachments initialInput="Review these files" />
  ),
};
