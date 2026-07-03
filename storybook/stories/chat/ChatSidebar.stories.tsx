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
  `ChatSidebar            <- one-shot preset: Root + NewButton + auto List
  +-- ChatSidebar.Root      <- context provider + rail container
       +-- ChatSidebar.NewButton  <- primary "new chat" action (onNewThread)
       +-- ChatSidebar.List       <- scroll region; auto-groups by recency
            +-- ChatSidebar.Group  <- a labeled recency bucket (Today / ...)
                 +-- ChatSidebar.Item   <- a thread row (select / rename / delete)
            +-- ChatSidebar.Empty  <- shown when there are no threads`;

const compositionCode = `import { ChatSidebar } from "veryfront/chat";

// The preset composes these for you; drop to the parts for custom layouts.
<ChatSidebar.Root
  threads={items}
  activeThreadId={activeThreadId}
  onSelectThread={select}
  onDeleteThread={remove}
  onRenameThread={rename}
  onNewThread={create}
>
  <ChatSidebar.NewButton>New chat</ChatSidebar.NewButton>

  {/* Auto: groups by recency, renders the empty state when there are none. */}
  <ChatSidebar.List />

  {/* …or bring your own grouping / rows: */}
  <ChatSidebar.List>
    <ChatSidebar.Group label="Pinned">
      {pinned.map((t) => <ChatSidebar.Item key={t.id} thread={t} />)}
    </ChatSidebar.Group>
  </ChatSidebar.List>
</ChatSidebar.Root>`;

const customGroupsCode = `import { ChatSidebar } from "veryfront/chat";

// Group threads however you like — Item pulls select/rename/delete from Root.
<ChatSidebar.Root {...ctx}>
  <ChatSidebar.NewButton />
  <ChatSidebar.List>
    <ChatSidebar.Group label="Pinned">
      {pinned.map((t) => <ChatSidebar.Item key={t.id} thread={t} />)}
    </ChatSidebar.Group>
    <ChatSidebar.Group label="Everything else">
      {rest.map((t) => <ChatSidebar.Item key={t.id} thread={t} />)}
    </ChatSidebar.Group>
  </ChatSidebar.List>
</ChatSidebar.Root>`;

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

      <DocsSection
        title="Loading"
        description="Pass `loading` to show a skeleton in place of the list — e.g. while threads are being fetched. The auto `List` also shows this on its own until the client mounts, so threads loading from `localStorage` never flash the empty state."
      >
        <DocsExampleAuto of={Loading} />
      </DocsSection>

      <DocsSection
        title="Composition"
        description="`ChatSidebar` is also a compound. `ChatSidebar.Root` holds the shared state; the parts (`NewButton`, `List`, `Group`, `Item`, `Empty`) read it from context — so you can reorder, restyle, or swap any piece without a render prop."
      >
        <DocsExampleAuto of={Composed} />
        <DocsCode code={compositionCode} />
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection
        title="Custom groups"
        description="Skip the recency buckets entirely: give `ChatSidebar.List` your own `Group` / `Item` children. Each `Item` still reads select, rename, and delete from `Root`."
      >
        <DocsExampleAuto of={CustomGroups} />
        <DocsCode code={customGroupsCode} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
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
              name: "loading",
              type: "boolean",
              description:
                "Show the loading skeleton instead of the list (auto until the client mounts)",
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
      <StoryFrame maxWidth="240px">
        <ReviewSurface label="Sidebar">
          <div className="h-[520px] overflow-hidden bg-[var(--sidebar-background)]">
            <ChatSidebar
              fill
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
    <StoryFrame maxWidth="240px">
      <ReviewSurface label="No conversations">
        <div className="h-[420px] overflow-hidden bg-[var(--sidebar-background)]">
          <ChatSidebar
            fill
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

export const Composed: Story = {
  name: "Composition",
  tags: ["!dev"],
  parameters: {
    docs: { source: { code: compositionCode } },
  },
  render: () => {
    const [activeThreadId, setActiveThreadId] = React.useState(
      threads[0]?.id ?? null,
    );
    const [items, setItems] = React.useState(threads);

    return (
      <StoryFrame maxWidth="240px">
        <ReviewSurface label="Composed from parts">
          <div className="h-[520px] overflow-hidden bg-[var(--sidebar-background)]">
            <ChatSidebar.Root
              fill
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
            >
              <ChatSidebar.NewButton>New chat</ChatSidebar.NewButton>
              <ChatSidebar.List />
            </ChatSidebar.Root>
          </div>
        </ReviewSurface>
      </StoryFrame>
    );
  },
};

export const CustomGroups: Story = {
  name: "Custom groups",
  tags: ["!dev"],
  parameters: {
    docs: { source: { code: customGroupsCode } },
  },
  render: () => {
    const [activeThreadId, setActiveThreadId] = React.useState(
      threads[0]?.id ?? null,
    );
    const [items, setItems] = React.useState(threads);
    const [pinnedIds, setPinnedIds] = React.useState<string[]>(
      threads[0]?.id ? [threads[0].id] : [],
    );

    const pinned = items.filter((t) => pinnedIds.includes(t.id));
    const rest = items.filter((t) => !pinnedIds.includes(t.id));

    return (
      <StoryFrame maxWidth="240px">
        <ReviewSurface label="Pinned + everything else">
          <div className="h-[520px] overflow-hidden bg-[var(--sidebar-background)]">
            <ChatSidebar.Root
              fill
              threads={items}
              activeThreadId={activeThreadId}
              onSelectThread={setActiveThreadId}
              onDeleteThread={(id) => {
                setItems((current) => current.filter((item) => item.id !== id));
                setPinnedIds((current) => current.filter((pid) => pid !== id));
              }}
              onRenameThread={(id, title) =>
                setItems((current) =>
                  current.map((item) => item.id === id ? { ...item, title } : item)
                )}
              onNewThread={() => undefined}
            >
              <ChatSidebar.NewButton />
              <ChatSidebar.List>
                {pinned.length > 0 && (
                  <ChatSidebar.Group label="Pinned">
                    {pinned.map((t) => (
                      <ChatSidebar.Item key={t.id} thread={t} />
                    ))}
                  </ChatSidebar.Group>
                )}
                <ChatSidebar.Group label="Everything else">
                  {rest.map((t) => <ChatSidebar.Item key={t.id} thread={t} />)}
                </ChatSidebar.Group>
              </ChatSidebar.List>
            </ChatSidebar.Root>
          </div>
        </ReviewSurface>
      </StoryFrame>
    );
  },
};

export const RowStates: Story = {
  name: "Row states",
  tags: ["!dev"],
  render: () => {
    const [items, setItems] = React.useState(threads.slice(0, 3));
    const [activeThreadId, setActiveThreadId] = React.useState(items[0]?.id ?? null);

    return (
      <StoryFrame maxWidth="240px">
        <ReviewSurface label="Item: default · active · rename (row height must not change on edit)">
          <div className="h-[320px] overflow-hidden bg-[var(--sidebar-background)]">
            <ChatSidebar.Root
              fill
              threads={items}
              activeThreadId={activeThreadId}
              onSelectThread={setActiveThreadId}
              onDeleteThread={(id) =>
                setItems((current) => current.filter((item) => item.id !== id))}
              onRenameThread={(id, title) =>
                setItems((current) =>
                  current.map((item) => (item.id === id ? { ...item, title } : item))
                )}
              onNewThread={() => undefined}
            >
              <ChatSidebar.List>
                <ChatSidebar.Group label="Today">
                  {items.map((t) => <ChatSidebar.Item key={t.id} thread={t} />)}
                </ChatSidebar.Group>
              </ChatSidebar.List>
            </ChatSidebar.Root>
          </div>
        </ReviewSurface>
      </StoryFrame>
    );
  },
};

export const Loading: Story = {
  name: "Loading",
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="240px">
      <ReviewSurface label="Loading state — `<ChatSidebar loading />` (auto until the client mounts)">
        <div className="h-[520px] overflow-hidden bg-[var(--sidebar-background)]">
          <ChatSidebar
            fill
            loading
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
