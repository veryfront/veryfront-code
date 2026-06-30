import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { ChatWithSidebar } from "veryfront/chat";
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
  modelOptions,
  quickActions,
  uploads,
} from "../fixtures/chat";

const importCode = `import { ChatWithSidebar } from "veryfront/chat"`;

const compositionTree =
  `ChatWithSidebar  <- assembly: thread rail + the Chat preset, with thread persistence
  +-- ChatSidebar  <- thread list rail (managed via useThreads)
  +-- TabSwitcher  <- chat / uploads tabs (when features.tabs)
  +-- Chat  <- the preset conversation UI, driven by the chat controller`;

function ChatWithSidebarDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ChatWithSidebar"
        lead="The `ChatWithSidebar` assembly — pairs a thread rail with the `Chat` preset and manages thread persistence. Configuration is grouped into `chat`, `sidebar`, `models`, `attachments`, `quickActions`, `features`, and `tabs`."
      />

      <DocsSection
        title="Default"
        description="The full assembly with an open sidebar, model selector, attachments, uploads, quick actions, and chat / uploads tabs."
      >
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ChatWithSidebar"
          description="Grouped configuration props"
          props={[
            {
              name: "chat",
              type: "ChatWithSidebarChatController",
              description:
                "Conversation state and handlers: messages, input, onChange, onSubmit, reload, stop, setMessages, model, etc.",
            },
            {
              name: "sidebar",
              type: "ChatWithSidebarSidebarConfig",
              description: "Rail open state, onToggle, storageKey, visible",
            },
            {
              name: "models",
              type: "ChatWithSidebarModelConfig",
              description: "{ options } for the model selector",
            },
            {
              name: "attachments",
              type: "ChatWithSidebarAttachmentConfig",
              description:
                "accept, items, uploads, onAttach, onDrop, onRemoveItem, onRemoveUpload",
            },
            {
              name: "quickActions",
              type: "ChatWithSidebarQuickActionsConfig",
              description:
                "suggestions, onSuggestionClick, actions, onAction",
            },
            {
              name: "message",
              type: "ChatWithSidebarMessageConfig",
              description: "render, renderTool, onFeedback, onSourceClick",
            },
            {
              name: "features",
              type: "ChatWithSidebarFeatureConfig",
              description:
                "Toggles: steps, tabs, sources, export, scrollButton, messageActions",
            },
            {
              name: "tabs",
              type: "ChatWithSidebarTabsConfig",
              description: "{ active, onChange } for the chat / uploads tabs",
            },
            {
              name: "voice",
              type: "ChatWithSidebarVoiceConfig",
              description: "{ enabled, onVoice } for voice input",
            },
            {
              name: "maxHeight",
              type: "string",
              description: "Max height of the assembly",
            },
            {
              name: "placeholder",
              type: "string",
              description: "Composer placeholder text",
            },
            {
              name: "theme",
              type: "Partial<ChatTheme>",
              description: "Theme token overrides",
            },
            {
              name: "emptyState",
              type: "{ icon?, title?, description? }",
              description: "Custom empty-state content",
            },
            {
              name: "className",
              type: "string",
              description: "Extra classes for the root element",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Composition/With Sidebar",
  component: ChatWithSidebar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ChatWithSidebarDocsPage },
  },
} satisfies Meta<typeof ChatWithSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

function SidebarReview(): React.ReactElement {
  const [messages, setMessages] = React.useState<ChatMessage[]>(chatMessages);
  const [input, setInput] = React.useState("Create a new thread summary");
  const [model, setModel] = React.useState(modelOptions[0]?.value);
  const [tab, setTab] = React.useState<"chat" | "uploads">("chat");
  const [sidebarOpen, setSidebarOpen] = React.useState(true);

  const submit = React.useCallback((event?: React.FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      {
        id: `sidebar-${current.length + 1}`,
        role: "user",
        parts: [{ type: "text", text }],
      },
    ]);
    setInput("");
  }, [input]);

  return (
    <div className="vf-story-canvas">
      <div className="vf-wide-panel">
        <ChatWithSidebar
          chat={{
            messages,
            input,
            onChange: createChangeHandler(setInput),
            onSubmit: submit,
            reload: () => setMessages(chatMessages),
            stop: () => undefined,
            setInput,
            model,
            activeModel: model,
            onModelChange: setModel,
            inferenceMode: "server-local",
            setMessages,
          }}
          sidebar={{
            open: sidebarOpen,
            onToggle: () => setSidebarOpen((open) => !open),
            storageKey: "veryfront-storybook-sidebar",
          }}
          models={{ options: modelOptions }}
          attachments={{
            accept: ".md,.txt,.csv",
            items: attachments,
            uploads,
            onAttach: () => undefined,
            onRemoveItem: () => undefined,
            onRemoveUpload: () => undefined,
          }}
          quickActions={{
            suggestions: [
              "Plan rollout",
              "Find test gaps",
              "Draft release note",
            ],
            onSuggestionClick: setInput,
            actions: quickActions,
            onAction: (action) => setInput(action.prompt ?? action.label),
          }}
          features={{
            tabs: true,
            sources: true,
            steps: true,
            export: true,
            scrollButton: true,
            messageActions: true,
          }}
          tabs={{
            active: tab,
            onChange: setTab,
          }}
          maxHeight="100%"
          placeholder="Ask about this project"
        />
      </div>
    </div>
  );
}

export const Default: Story = {
  tags: ["!dev"],
  render: () => <SidebarReview />,
};
