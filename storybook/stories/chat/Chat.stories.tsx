import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { Chat } from "veryfront/chat";
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
  attachments,
  chatMessages,
  createChangeHandler,
  loadingMessages,
  modelOptions,
  quickActions,
} from "../fixtures/chat";

const importCode = `import { Chat } from "veryfront/chat"`;

const compositionTree =
  `Chat  <- preset assembly: wires the building blocks into a full chat UI
  +-- ChatMessageList  <- the conversation transcript (messages, sources, steps)
  +-- ConversationEmptyState  <- shown when messages is empty
  +-- ErrorBanner  <- shown when error is set
  +-- QuickActions / Suggestions  <- prompt chips above the composer
  +-- ChatComposer  <- input, attachments, model selector, submit / stop`;

function ChatDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Chat"
        lead="The `Chat` preset — a fully wired conversation UI assembled from the chat building blocks. Drive it with messages plus the input and submit handlers."
      />

      <DocsSection
        title="Conversation"
        description="A populated transcript with sources and reasoning steps enabled, plus a draft message in the composer."
      >
        <DocsExampleAuto of={Conversation} />
      </DocsSection>

      <DocsSection
        title="Empty"
        description="With no messages, the preset shows its empty state and exposes the model selector."
      >
        <DocsExampleAuto of={Empty} />
      </DocsSection>

      <DocsSection
        title="Loading"
        description="`isLoading` streams the latest assistant turn and swaps submit for a stop control."
      >
        <DocsExampleAuto of={Loading} />
      </DocsSection>

      <DocsSection
        title="Error"
        description="Passing an `error` renders a recoverable error banner with a reload affordance."
      >
        <DocsExampleAuto of={ErrorState} />
      </DocsSection>

      <DocsSection
        title="Tools and Sources"
        description="With `showSources` and `showSteps`, tool calls and citations render inline within the transcript."
      >
        <DocsExampleAuto of={ToolAndSources} />
      </DocsSection>

      <DocsSection
        title="Models and Attachments"
        description="Supply `models` for the in-composer selector and `attachments` to render attachment pills."
      >
        <DocsExampleAuto of={ModelsAndAttachments} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Chat"
          description="Preset conversation assembly (selected props)"
          props={[
            {
              name: "messages",
              type: "ChatMessage[]",
              description: "The conversation transcript",
            },
            {
              name: "input",
              type: "string",
              description: "Current composer value",
            },
            {
              name: "onChange",
              type: "(e) => void",
              description: "Input change handler",
            },
            {
              name: "onSubmit",
              type: "(e?) => void | Promise<void>",
              description: "Called when the message is sent",
            },
            {
              name: "stop",
              type: "() => void",
              description: "Abort the in-flight response",
            },
            {
              name: "reload",
              type: "() => void",
              description: "Regenerate the last response",
            },
            {
              name: "setInput",
              type: "(value: string) => void",
              description: "Programmatically set the composer value",
            },
            {
              name: "isLoading",
              type: "boolean",
              description: "Whether a response is streaming",
            },
            {
              name: "error",
              type: "Error | null",
              description: "Renders the error banner when set",
            },
            {
              name: "placeholder",
              type: "string",
              default: '"Type a message..."',
              description: "Composer placeholder text",
            },
            {
              name: "showSources",
              type: "boolean",
              default: "false",
              description: "Render inline citations / sources",
            },
            {
              name: "showSteps",
              type: "boolean",
              default: "false",
              description: "Render reasoning step indicators",
            },
            {
              name: "showScrollButton",
              type: "boolean",
              default: "false",
              description: "Show the scroll-to-bottom button",
            },
            {
              name: "showExport",
              type: "boolean",
              default: "false",
              description: "Show the export-as-markdown action",
            },
            {
              name: "models",
              type: "ModelOption[]",
              description: "Options for the in-composer model selector",
            },
            {
              name: "model",
              type: "string",
              description: "Selected model id",
            },
            {
              name: "activeModel",
              type: "string",
              description: "Resolved model used for avatar display",
            },
            {
              name: "onModelChange",
              type: "(model: string) => void",
              description: "Called when the model selection changes",
            },
            {
              name: "attachments",
              type: "AttachmentInfo[]",
              description: "Attachment pills shown in the composer",
            },
            {
              name: "onRemoveAttachment",
              type: "(id: string) => void",
              description: "Remove a pending attachment",
            },
            {
              name: "quickActions",
              type: "QuickAction[]",
              description: "Prompt chips offered above the composer",
            },
            {
              name: "onQuickAction",
              type: "(action: QuickAction) => void",
              description: "Called when a quick action is chosen",
            },
            {
              name: "suggestions",
              type: "string[]",
              description: "Suggested prompt strings",
            },
            {
              name: "onSuggestionClick",
              type: "(suggestion: string) => void",
              description: "Called when a suggestion is chosen",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Composition/Preset",
  component: Chat,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ChatDocsPage },
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
  tags: ["!dev"],
  render: () => <ChatReview />,
};

export const Empty: Story = {
  tags: ["!dev"],
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
  tags: ["!dev"],
  render: () => <ChatReview initialMessages={loadingMessages} isLoading />,
};

export const Skeleton: Story = {
  tags: ["!dev"],
  render: () => <ChatReview initialMessages={[]} initialInput="" isLoading />,
};

export const ErrorState: Story = {
  name: "Error",
  tags: ["!dev"],
  render: () => (
    <ChatReview
      error={new Error("The hosted agent returned a recoverable stream error.")}
      withModels
    />
  ),
};

export const ToolAndSources: Story = {
  tags: ["!dev"],
  render: () => <ChatReview showSources showSteps />,
};

export const ModelsAndAttachments: Story = {
  tags: ["!dev"],
  render: () => (
    <ChatReview withModels withAttachments initialInput="Review these files" />
  ),
};
