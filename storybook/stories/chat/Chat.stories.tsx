import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { AgentAvatar, AgentPicker, Chat } from "veryfront/chat";
import type { AgentOption, AttachmentInfo, ChatMessage } from "veryfront/chat";
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
  filesToAttachments,
  loadingMessages,
  modelOptions,
} from "../fixtures/chat";

const importCode = `import { Chat } from "veryfront/chat"`;

const agentOptions: AgentOption[] = [
  { id: "veryfront", name: "Veryfront Agent" },
  { id: "inbox-helper", name: "Inbox Helper" },
  { id: "researcher", name: "Research Agent" },
];

/**
 * Real `<Chat>` usage shown in each story's Code tab — driven by `useChat`, the
 * way a consumer actually wires it. Empty / Loading / Error are backend state,
 * not code differences; `extra` only adds real config props (models, sources…).
 */
function chatCode(extra = ""): string {
  return `import { Chat, useChat } from "veryfront/chat";

function ChatPanel() {
  const chat = useChat({ agentId: "veryfront", api: "/api/ag-ui" });

  return (
    <Chat
      messages={chat.messages}
      input={chat.input}
      onChange={chat.onChange}
      onSubmit={chat.onSubmit}
      isLoading={chat.isLoading}
      error={chat.error}${extra}
    />
  );
}`;
}

/** Attach a real-usage code snippet to a story's Docs "Code" tab. */
function codeParams(extra = "") {
  return { docs: { source: { code: chatCode(extra) } } };
}

const compositionTree =
  `Chat  <- preset assembly: wires the building blocks into a full chat UI
  +-- ChatMessageList  <- the conversation transcript (messages, sources, steps)
  +-- ConversationEmptyState  <- shown when messages is empty
  +-- ErrorBanner  <- shown when error is set
  +-- QuickActions / Suggestions  <- prompt chips above the composer
  +-- ChatInput  <- input, attachments, model selector, submit / stop`;

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
  title: "Chat/Components/Chat",
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
  initializing?: boolean;
  error?: Error | null;
  showSources?: boolean;
  showSteps?: boolean;
  withAttachments?: boolean;
};

function ChatReview({
  initialMessages = chatMessages,
  initialInput = "Can you turn this into a release checklist?",
  isLoading = false,
  initializing = false,
  error = null,
  showSources = true,
  showSteps = true,
  withAttachments = false,
}: ChatReviewProps): React.ReactElement {
  const [messages, setMessages] = React.useState<ChatMessage[]>(
    initialMessages,
  );
  const [input, setInput] = React.useState(initialInput);
  const [model, setModel] = React.useState(modelOptions[0]?.value);
  const [agent, setAgent] = React.useState(agentOptions[0].id);
  const [files, setFiles] = React.useState<AttachmentInfo[]>(
    withAttachments ? attachments : [],
  );

  // Drag a file onto the composer (or use the `+` menu) → it lands here and
  // renders as a pill, so drag-to-attach is fully working inside <Chat>.
  const addFiles = (list: FileList) =>
    setFiles((current) => [...current, ...filesToAttachments(list)]);

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
          onVoice={() => undefined}
          setInput={setInput}
          isLoading={isLoading}
          initializing={initializing}
          error={error}
          placeholder="Ask Veryfront"
          showSources={showSources}
          showSteps={showSteps}
          showScrollButton
          models={modelOptions}
          model={model}
          activeModel={model}
          onModelChange={setModel}
          onAttach={addFiles}
          onDrop={addFiles}
          attachments={files}
          onRemoveAttachment={(id) =>
            setFiles((current) => current.filter((file) => file.id !== id))}
          toolbarStart={
            <AgentPicker
              agents={agentOptions}
              value={agent}
              onValueChange={setAgent}
            />
          }
          emptyState={{
            icon: <AgentAvatar name="Veryfront Agent" className="size-16" />,
            title: "What can I help with?",
          }}
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
  parameters: codeParams("\n      showSources\n      showSteps"),
};

export const Empty: Story = {
  tags: ["!dev"],
  render: () => (
    <ChatReview
      initialMessages={[]}
      initialInput=""
      showSources={false}
      showSteps={false}
    />
  ),
  parameters: codeParams(),
};

export const Loading: Story = {
  tags: ["!dev"],
  render: () => <ChatReview initialMessages={loadingMessages} isLoading />,
  parameters: codeParams(),
};

export const Skeleton: Story = {
  tags: ["!dev"],
  render: () => <ChatReview initialMessages={[]} initialInput="" isLoading />,
  parameters: codeParams(),
};

// App mode (`<Chat agentId>`) derives this automatically while agent metadata
// resolves — the skeleton shows out of the box instead of flashing the idle
// "What can I help with?" state. Here we drive it explicitly via `initializing`.
export const Initializing: Story = {
  name: "Initializing",
  tags: ["!dev"],
  render: () => <ChatReview initialMessages={[]} initialInput="" initializing />,
  parameters: codeParams("\n      initializing"),
};

export const ErrorState: Story = {
  name: "Error",
  tags: ["!dev"],
  render: () => (
    <ChatReview
      error={new Error("The hosted agent returned a recoverable stream error.")}
    />
  ),
  parameters: codeParams(),
};

export const ToolAndSources: Story = {
  tags: ["!dev"],
  render: () => <ChatReview showSources showSteps />,
  parameters: codeParams("\n      showSources\n      showSteps"),
};

export const ModelsAndAttachments: Story = {
  tags: ["!dev"],
  render: () => (
    <ChatReview withAttachments initialInput="Review these files" />
  ),
  parameters: codeParams(
    "\n      models={models}\n      onModelChange={chat.onModelChange}\n      onAttach={handleAttach}",
  ),
};
