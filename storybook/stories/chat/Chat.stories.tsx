import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { AgentAvatar, AgentPicker, Chat } from "veryfront/chat";
import type {
  AgentOption,
  AttachmentInfo,
  ChatMessage,
  UseChatResult,
} from "veryfront/chat";
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

const composeVsOverrideCode = `import { Chat } from "veryfront/chat";

// Compose the structure and include only the parts your layout needs.
<Chat.Root messages={messages} input={input} onSubmit={onSubmit}>
  <Chat.MessageList messages={messages}>
    <Chat.MessageList.Content>
      {messages.map((message) => (
        <Chat.Message.Root key={message.id} message={message}>
          <Chat.Message.Content />
          <Chat.Message.Sources />
          <Chat.Message.Actions />
        </Chat.Message.Root>
      ))}
    </Chat.MessageList.Content>
  </Chat.MessageList>
  <Chat.Input.Root input={input} onChange={onChange} onSubmit={onSubmit}>
    <Chat.Input.Field placeholder="Ask Veryfront" />
    <Chat.Input.Toolbar>
      <Chat.Input.Export messages={messages} />
      <Chat.Input.Send />
    </Chat.Input.Toolbar>
  </Chat.Input.Root>
</Chat.Root>

// The preset takes one complete session object.
<Chat chat={chat} renderMessage={(message) => <MyMessageRow message={message} />} />`;

const agentOptions: AgentOption[] = [
  { id: "veryfront", name: "Veryfront Agent" },
  { id: "inbox-helper", name: "Inbox Helper" },
  { id: "researcher", name: "Research Agent" },
];

/**
 * Real `<Chat>` usage shown in each story's Code tab, driven by `useChat`, the
 * way a consumer actually wires it. Empty / Loading / Error are backend state,
 * not code differences; `extra` only adds supported configuration props.
 */
function chatCode(extra = ""): string {
  return `import { Chat, useChat } from "veryfront/chat";

function ChatPanel() {
  const chat = useChat({ agentId: "veryfront", api: "/api/ag-ui" });

  return (
    <Chat chat={chat}${extra} />
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
  +-- ChatInput  <- input, attachments, model selector, submit / stop`;

function ChatDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Chat"
        lead="The `Chat` preset is a fully wired conversation UI assembled from the chat building blocks. Drive it with one `useChat()` session."
      />

      <DocsSection
        title="Conversation"
        description="A populated transcript with the preset's sources, reasoning steps, message actions, scroll control, and composer."
      >
        <DocsExampleAuto of={Conversation} />
      </DocsSection>

      <DocsSection
        title="Compose"
        description="Use `Chat.Root` and the building blocks to own the layout. Include transcript, message, and composer parts by presence."
      >
        <DocsExampleAuto of={Composed} />
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
        description="The preset renders tool calls, reasoning steps, and citations when the message parts contain them."
      >
        <DocsExampleAuto of={ToolAndSources} />
      </DocsSection>

      <DocsSection
        title="Models and Attachments"
        description="Supply models through `agent` and attachments through the preset's attachment API."
      >
        <DocsExampleAuto of={ModelsAndAttachments} />
      </DocsSection>

      <DocsSection
        title="Compose vs override"
        description={`Two different jobs use two different APIs. **Compose the structure** with \`Chat.Root\`, \`Message.Root\`, and their sub-parts.

**Override repeated data rendering** with \`renderMessage\` for whole rows or a function child on \`Message.Content\` for individual message parts.

Use children for fixed structure and a render callback for repeated data.`}
      >
        <DocsCode code={composeVsOverrideCode} />
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
              name: "chat",
              type: "UseChatResult",
              description: "Complete session returned by useChat()",
            },
            {
              name: "agentId",
              type: "string",
              description: "Agent id for the self-driven preset mode",
            },
            {
              name: "api",
              type: "string",
              default: '"/api/ag-ui"',
              description: "AG-UI endpoint for self-driven preset mode",
            },
            {
              name: "initialMessages",
              type: "ChatMessage[]",
              description: "Initial transcript for self-driven preset mode",
            },
            {
              name: "agent",
              type: "ChatAgentInfo",
              description: "Agent identity, suggestions, and model options",
            },
            {
              name: "placeholder",
              type: "string",
              default: '"Type a message..."',
              description: "Composer placeholder text",
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
            {
              name: "renderMessage",
              type: "(message) => ReactNode",
              description: "Override how every message row renders",
            },
            {
              name: "uploadApi",
              type: "string",
              description: "Endpoint for durable attachment uploads",
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
  withAttachments?: boolean;
};

function ChatReview({
  initialMessages = chatMessages,
  initialInput = "Can you turn this into a release checklist?",
  isLoading = false,
  initializing = false,
  error = null,
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

  // Drag a file onto the composer (or use the `+` menu). It lands here and
  // renders as a pill, so drag-to-attach is fully working inside <Chat>.
  const addFiles = (list: FileList) =>
    setFiles((current) => [...current, ...filesToAttachments(list)]);

  const appendMessage = React.useCallback((text: string) => {
    if (!text.trim()) return;
    setMessages((current) => [
      ...current,
      {
        id: `story-user-${current.length + 1}`,
        role: "user",
        createdAt: new Date().toISOString(),
        parts: [{ type: "text", text }],
      },
    ]);
  }, []);

  const submitMessage = React.useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text) return;
    appendMessage(text);
    setInput("");
  }, [appendMessage, input]);

  const chat = React.useMemo<UseChatResult>(() => ({
    messages,
    input,
    isLoading,
    error,
    model,
    activeModel: model,
    inferenceMode: "cloud",
    setInput,
    setModel,
    sendMessage: async ({ text }) => {
      appendMessage(text);
      setInput("");
    },
    editMessage: () => Promise.resolve(),
    getBranches: () => ({ current: 1, total: 1 }),
    switchBranch: () => {},
    reload: async () => setMessages(initialMessages),
    stop: () => {},
    setMessages,
    addToolOutput: () => {},
    handleInputChange: createChangeHandler(setInput),
    handleSubmit: submitMessage,
  }), [
    appendMessage,
    error,
    initialMessages,
    input,
    isLoading,
    messages,
    model,
    submitMessage,
  ]);

  return (
    <div className="vf-story-canvas">
      <div className="vf-chat-panel">
        <Chat
          chat={chat}
          initializing={initializing}
          placeholder="Ask Veryfront"
          agent={{ models: modelOptions }}
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
          onSuggestionSelect={(suggestion) => setInput(suggestion.prompt)}
        />
      </div>
    </div>
  );
}

export const Conversation: Story = {
  tags: ["!dev"],
  render: () => <ChatReview />,
  parameters: codeParams(),
};

/** Own the layout: `Chat.Root` provides context; you place the blocks. */
function ChatComposedReview(): React.ReactElement {
  const [messages, setMessages] = React.useState<ChatMessage[]>(chatMessages);
  const [input, setInput] = React.useState("");
  const onSubmit = (event?: React.FormEvent) => {
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
  };
  return (
    <div className="vf-story-canvas">
      <div className="vf-chat-panel">
        <Chat.Root
          messages={messages}
          input={input}
          onSubmit={onSubmit}
        >
          <Chat.MessageList messages={messages}>
            <Chat.MessageList.Content>
              {messages.map((message) => (
                <Chat.Message.Root key={message.id} message={message}>
                  <Chat.Message.Content />
                  <Chat.Message.Sources />
                  <Chat.Message.Actions />
                </Chat.Message.Root>
              ))}
            </Chat.MessageList.Content>
          </Chat.MessageList>
          <Chat.Input.Root
            input={input}
            onChange={createChangeHandler(setInput)}
            onSubmit={onSubmit}
          >
            <Chat.Input.Field placeholder="Ask Veryfront" />
            <Chat.Input.Toolbar>
              <Chat.Input.Export messages={messages} />
              <Chat.Input.Send />
            </Chat.Input.Toolbar>
          </Chat.Input.Root>
        </Chat.Root>
      </div>
    </div>
  );
}

export const Composed: Story = {
  tags: ["!dev"],
  render: () => <ChatComposedReview />,
  parameters: {
    docs: {
      source: {
        code: `import { Chat } from "veryfront/chat";

// Chat.Root provides the shared context; you arrange the blocks yourself.
<Chat.Root messages={messages} input={input} onSubmit={onSubmit}>
  <Chat.MessageList messages={messages}>
    <Chat.MessageList.Content>
      {messages.map((message) => (
        <Chat.Message.Root key={message.id} message={message}>
          <Chat.Message.Content />
          <Chat.Message.Sources />
          <Chat.Message.Actions />
        </Chat.Message.Root>
      ))}
    </Chat.MessageList.Content>
  </Chat.MessageList>
  <Chat.Input.Root input={input} onChange={onChange} onSubmit={onSubmit}>
    <Chat.Input.Field placeholder="Ask Veryfront" />
    <Chat.Input.Toolbar>
      <Chat.Input.Export messages={messages} />
      <Chat.Input.Send />
    </Chat.Input.Toolbar>
  </Chat.Input.Root>
</Chat.Root>`,
      },
    },
  },
};

export const Empty: Story = {
  tags: ["!dev"],
  render: () => <ChatReview initialMessages={[]} initialInput="" />,
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
// resolves, so the skeleton shows instead of flashing the idle
// "What can I help with?" state. Here we drive it explicitly via `initializing`.
export const Initializing: Story = {
  name: "Initializing",
  tags: ["!dev"],
  render: () => (
    <ChatReview
      initialMessages={[]}
      initialInput=""
      initializing
    />
  ),
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
  render: () => <ChatReview />,
  parameters: codeParams(),
};

export const ModelsAndAttachments: Story = {
  tags: ["!dev"],
  render: () => (
    <ChatReview
      withAttachments
      initialInput="Review these files"
    />
  ),
  parameters: codeParams(
    "\n      agent={{ models }}\n      onAttach={handleAttach}",
  ),
};
