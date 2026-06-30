import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import {
  NavGrid,
  type NavGridEntry,
  Page,
  PageHero,
} from "../.storybook/components";

// Chat landing page — mirrors the Veryfront Studio "Overview" concept: a hero
// plus a navigable grid of every chat surface, grouped by Components,
// Composition, and Primitives. Tagged `showcase` so the addon panel is hidden.
const meta = {
  title: "Chat/Overview",
  tags: ["showcase"],
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const COMPONENTS: NavGridEntry[] = [
  { title: "Message", id: "chat-components-message--docs" },
  { title: "AgentCard", id: "chat-components-agentcard--docs" },
  { title: "ChatComposer", id: "chat-components-chatcomposer--docs" },
  { title: "ChatSidebar", id: "chat-components-chatsidebar--docs" },
  { title: "ModelSelector", id: "chat-components-modelselector--docs" },
  { title: "AttachmentPill", id: "chat-components-attachmentpill--docs" },
  { title: "UploadsPanel", id: "chat-components-uploadspanel--docs" },
  { title: "Sources", id: "chat-components-sources--docs" },
  { title: "ReasoningCard", id: "chat-components-reasoningcard--docs" },
  { title: "ToolCallCard", id: "chat-components-toolcallcard--docs" },
  { title: "Markdown", id: "chat-components-markdown--docs" },
  {
    title: "Action Components",
    id: "chat-components-action-components--docs",
  },
];

const COMPOSITION: NavGridEntry[] = [
  { title: "Preset", id: "chat-composition-preset--docs" },
  { title: "Anatomy", id: "chat-composition-anatomy--docs" },
  { title: "With Sidebar", id: "chat-composition-with-sidebar--docs" },
  { title: "Subcomponents", id: "chat-composition-subcomponents--docs" },
  {
    title: "React Primitives",
    id: "chat-composition-react-primitives--docs",
  },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
      {children}
    </h2>
  );
}

function ChatOverviewPage() {
  return (
    <Page>
      <PageHero
        title="Chat"
        description="The chat components Veryfront ships — message turns, composer, sidebar, and the full assembled experiences. Open any entry for states, composition, and API reference."
      />

      <div className="space-y-12 py-16">
        <section>
          <SectionLabel>Components</SectionLabel>
          <NavGrid pages={COMPONENTS} />
        </section>
        <section>
          <SectionLabel>Composition</SectionLabel>
          <NavGrid pages={COMPOSITION} />
        </section>
      </div>
    </Page>
  );
}

// `name: "Overview"` matches the title's last segment so Storybook collapses
// the component + its single story into one sidebar leaf — "Overview" sits
// directly under "Chat", not as an "Overview › Default" folder.
export const Default: Story = {
  name: "Overview",
  render: () => <ChatOverviewPage />,
};
