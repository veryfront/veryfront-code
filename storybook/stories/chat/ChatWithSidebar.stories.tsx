import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { ChatWithSidebar } from "veryfront/chat";
import type { ChatMessage } from "veryfront/chat";
import {
  attachments,
  chatMessages,
  createChangeHandler,
  modelOptions,
  quickActions,
  uploads,
} from "../fixtures/chat";

const meta = {
  title: "Veryfront UI/Chat/With Sidebar",
  component: ChatWithSidebar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
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
  render: () => <SidebarReview />,
};
