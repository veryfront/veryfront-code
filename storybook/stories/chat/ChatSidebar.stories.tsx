import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { ChatSidebar } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { threads } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode = `import { ChatSidebar } from "veryfront/chat"`;

const compositionTree =
  `ChatSidebar  <- thread list rail, grouped by recency (Today / Yesterday / ...)
  +-- New thread button  <- onNewThread
  +-- Thread item  <- onSelectThread / onDeleteThread / onRenameThread
  +-- Empty state  <- shown when threads is empty`;

function ChatSidebarDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ChatSidebar"
        lead="A conversation rail for `ChatWithSidebar` — lists threads grouped by recency, with select, rename, delete, and new-thread actions."
      />

      <DocsSection
        title="Default"
        description="A populated rail with an active thread. Selecting, renaming, and deleting are wired to local state in this example."
      >
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="Empty"
        description="With no threads, the sidebar renders its empty state."
      >
        <DocsExampleAuto of={Empty} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ChatSidebar"
          description="Thread list rail"
          props={[
            {
              name: "threads",
              type: "Thread[]",
              description: "Conversation threads to list, newest first",
            },
            {
              name: "activeThreadId",
              type: "string | null",
              description: "The currently selected thread, or null",
            },
            {
              name: "onSelectThread",
              type: "(id: string) => void",
              description: "Called when a thread is chosen",
            },
            {
              name: "onDeleteThread",
              type: "(id: string) => void",
              description: "Called when a thread is deleted",
            },
            {
              name: "onRenameThread",
              type: "(id: string, title: string) => void",
              description: "Called when a thread title is edited",
            },
            {
              name: "onNewThread",
              type: "() => void",
              description: "Called to start a new conversation",
            },
            {
              name: "isOpen",
              type: "boolean",
              description: "Whether the rail is currently shown",
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
  title: "Chat/Components/ChatSidebar",
  component: ChatSidebar,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ChatSidebarDocsPage },
  },
} satisfies Meta<typeof ChatSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { ChatSidebar } from "veryfront/chat";

const [activeThreadId, setActiveThreadId] = React.useState(threads[0]?.id ?? null);
const [items, setItems] = React.useState(threads);

<ChatSidebar
  threads={items}
  activeThreadId={activeThreadId}
  onSelectThread={setActiveThreadId}
  onDeleteThread={(id) =>
    setItems((current) => current.filter((item) => item.id !== id))}
  onRenameThread={(id, title) =>
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, title } : item)))}
  onNewThread={() => createThread()}
/>`,
      },
    },
  },
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
                  current.map((item) => item.id === id ? { ...item, title } : item)
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
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { ChatSidebar } from "veryfront/chat";

<ChatSidebar
  threads={[]}
  activeThreadId={null}
  onSelectThread={(id) => selectThread(id)}
  onDeleteThread={(id) => deleteThread(id)}
  onNewThread={() => createThread()}
/>`,
      },
    },
  },
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
