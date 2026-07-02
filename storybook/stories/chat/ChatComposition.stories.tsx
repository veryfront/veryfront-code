import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import {
  ChatInput,
  ChatEmpty,
  ChatMessageList,
  ChatRoot,
  ErrorBanner,
  Message,
} from "veryfront/chat";
import type { ChatMessage } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import {
  chatMessages,
  createChangeHandler,
  modelOptions,
  quickActions,
} from "../fixtures/chat";

const importCode =
  `import { ChatRoot, ChatMessageList, ChatInput, ChatEmpty, ErrorBanner, Message } from "veryfront/chat"`;

const compositionTree = `ChatRoot  <- context: messages, input, model, error, sources
  +-- ChatEmpty  <- empty state with quick actions (when no messages)
  +-- ChatMessageList  <- renders the message turns
  |     +-- Message  <- one turn per message (compound parts)
  +-- ErrorBanner  <- inline retry surface when error is set
  +-- ChatInput  <- input, model selector, export, submit`;

function ChatCompositionDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Composition — Anatomy"
        lead="Assemble a full chat from the exported building blocks. `ChatRoot` provides context; `ChatMessageList`, `ChatInput`, `ChatEmpty`, and `ErrorBanner` plug into it."
      />

      <DocsSection
        title="Assembled chat"
        description="`ChatRoot` wraps a `ChatMessageList` and a `ChatInput`, sharing input, model, and error state."
      >
        <DocsExampleAuto of={AssembledChat} />
      </DocsSection>

      <DocsSection
        title="Empty composition"
        description="With no messages, `ChatEmpty` renders a welcome state and quick actions."
      >
        <DocsExampleAuto of={EmptyComposition} />
      </DocsSection>

      <DocsSection
        title="Error composition"
        description="When `error` is set, `ErrorBanner` surfaces an inline retry."
      >
        <DocsExampleAuto of={ErrorComposition} />
      </DocsSection>

      <DocsSection
        title="Message compound"
        description="`Message.Root` plus its parts renders a single turn outside of a full chat shell."
      >
        <DocsExampleAuto of={MessageCompound} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ChatRoot"
          description="Context provider and container for the compound chat system"
          props={[
            {
              name: "messages",
              type: "ChatMessage[]",
              description: "Conversation turns to render",
            },
            {
              name: "input",
              type: "string",
              description: "Current composer input value",
            },
            {
              name: "setInput",
              type: "(value: string) => void",
              description: "Updates the composer input value",
            },
            {
              name: "onSubmit",
              type: "(e?: FormEvent) => void | Promise<void>",
              description: "Called when the composer submits",
            },
            {
              name: "onReload",
              type: "() => void",
              description: "Regenerates the last response",
            },
            {
              name: "error",
              type: "Error | null",
              description: "Error to surface in the chat",
            },
            {
              name: "model",
              type: "string",
              description: "Currently selected model id",
            },
            {
              name: "models",
              type: "ModelOption[]",
              default: "[]",
              description: "Available models for the selector",
            },
            {
              name: "onModelChange",
              type: "(modelId: string) => void",
              description: "Called when the model changes",
            },
            {
              name: "showSources",
              type: "boolean",
              description: "Render source citations on messages",
            },
          ]}
        />
        <DocsPropsTable
          component="ChatMessageList"
          description="Renders the conversation turns"
          props={[
            {
              name: "messages",
              type: "ChatMessage[]",
              description: "Conversation turns to render",
            },
            {
              name: "model",
              type: "string",
              description: "Model id used for avatar / metadata",
            },
            {
              name: "showSources",
              type: "boolean",
              default: "false",
              description: "Render source citations",
            },
            {
              name: "showSteps",
              type: "boolean",
              default: "false",
              description: "Render reasoning / step indicators",
            },
            {
              name: "showScrollButton",
              type: "boolean",
              default: "false",
              description: "Show the scroll-to-bottom button",
            },
            {
              name: "showMessageActions",
              type: "boolean",
              default: "true",
              description: "Show per-message actions",
            },
            {
              name: "onFeedback",
              type: "(messageId, feedback) => void",
              description: "Called when the user rates a message",
            },
          ]}
        />
        <DocsPropsTable
          component="ChatInput"
          description="Input, model selector, export, and submit control"
          props={[
            {
              name: "input",
              type: "string",
              description: "Current input value",
            },
            {
              name: "onChange",
              type: "(e: ChangeEvent) => void",
              description: "Called when the input changes",
            },
            {
              name: "onSubmit",
              type: "(e?: FormEvent) => void",
              description: "Called when the composer submits",
            },
            {
              name: "models",
              type: "ModelOption[]",
              description: "Available models for the selector",
            },
            {
              name: "model",
              type: "string",
              description: "Currently selected model id",
            },
            {
              name: "onModelChange",
              type: "(model: string) => void",
              description: "Called when the model changes",
            },
            {
              name: "showExport",
              type: "boolean",
              default: "false",
              description: "Show the export-as-markdown control",
            },
            {
              name: "messages",
              type: "ChatMessage[]",
              description: "Messages used by the export action",
            },
          ]}
        />
        <DocsPropsTable
          component="Message.Root"
          description="Compound context provider for a single turn"
          props={[
            {
              name: "message",
              type: "ChatMessage",
              description: "The message to render",
            },
            {
              name: "feedback",
              type: "FeedbackValue | null",
              description: "Current feedback state",
            },
            {
              name: "onFeedback",
              type: "(messageId, feedback) => void",
              description: "Called when the user rates the message",
            },
            {
              name: "getBranches",
              type: "(messageId) => BranchInfo",
              description: "Supplies branch state to BranchPicker",
            },
            {
              name: "switchBranch",
              type: "(messageId, branchIndex) => void",
              description: "Navigate between regenerated responses",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Composition/Anatomy",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ChatCompositionDocsPage },
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
          <ChatInput
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
  tags: ["!dev"],
  render: () => <CompositionCanvas />,
};

export const EmptyComposition: Story = {
  tags: ["!dev"],
  render: () => <CompositionCanvas initialMessages={[]} />,
};

export const ErrorComposition: Story = {
  tags: ["!dev"],
  render: () => (
    <CompositionCanvas error={new Error("The composed request failed.")} />
  ),
};

export const MessageCompound: Story = {
  tags: ["!dev"],
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
