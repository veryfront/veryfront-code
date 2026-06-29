import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { ChatSidebar } from "veryfront/chat";
import { threads } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const meta = {
  title: "Veryfront UI/Chat/ChatSidebar",
  component: ChatSidebar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ChatSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [activeThreadId, setActiveThreadId] = React.useState(
      threads[0]?.id ?? null,
    );
    const [items, setItems] = React.useState(threads);

    return (
      <StoryFrame maxWidth="360px">
        <ReviewSurface label="Sidebar">
          <div className="h-[520px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--outline-border)] bg-[var(--sidebar-background)]">
            <ChatSidebar
              threads={items}
              activeThreadId={activeThreadId}
              onSelectThread={setActiveThreadId}
              onDeleteThread={(id) =>
                setItems((current) => current.filter((item) => item.id !== id))}
              onRenameThread={(id, title) =>
                setItems((current) =>
                  current.map((item) =>
                    item.id === id ? { ...item, title } : item
                  )
                )}
              onNewThread={() => undefined}
            />
          </div>
        </ReviewSurface>
      </StoryFrame>
    );
  },
};

export const Empty: Story = {
  render: () => (
    <StoryFrame maxWidth="360px">
      <ReviewSurface label="No conversations">
        <div className="h-[420px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--outline-border)] bg-[var(--sidebar-background)]">
          <ChatSidebar
            threads={[]}
            activeThreadId={null}
            onSelectThread={() => undefined}
            onDeleteThread={() => undefined}
            onNewThread={() => undefined}
          />
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};
