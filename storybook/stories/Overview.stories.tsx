import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import {
  NavGrid,
  type NavGridEntry,
  Page,
  PageHero,
} from "../.storybook/components";

// Chat landing page — mirrors the Veryfront Studio "Overview" concept: a hero
// plus a navigable grid of every chat surface, grouped by Components and UI.
// Tagged `showcase` so the addon panel is hidden.
const meta = {
  title: "Chat/Overview",
  tags: ["showcase"],
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const COMPONENTS: NavGridEntry[] = [
  { title: "Chat", id: "chat-components-chat--docs" },
  { title: "ChatEmptyState", id: "chat-components-chatemptystate--docs" },
  { title: "Message", id: "chat-components-message--docs" },
  { title: "AgentCard", id: "chat-components-agentcard--docs" },
  { title: "ChatInput", id: "chat-components-chatinput--docs" },
  { title: "ChatActions", id: "chat-components-chatactions--docs" },
  { title: "ChatSidebar", id: "chat-components-chatsidebar--docs" },
  { title: "ModelSelector", id: "chat-components-modelselector--docs" },
  { title: "AgentPicker", id: "chat-components-agentpicker--docs" },
  { title: "AttachmentPill", id: "chat-components-attachmentpill--docs" },
  { title: "AttachmentsPanel", id: "chat-components-attachmentspanel--docs" },
  { title: "Sources", id: "chat-components-sources--docs" },
  { title: "Reasoning", id: "chat-components-reasoning--docs" },
  { title: "StepIndicator", id: "chat-components-stepindicator--docs" },
  { title: "ToolCall", id: "chat-components-toolcall--docs" },
  { title: "Markdown", id: "chat-components-markdown--docs" },
];

// The `veryfront/ui` primitives the chat components are built on (forked
// from Veryfront Studio, dependency-light).
const UI: NavGridEntry[] = [
  { title: "AppShell", id: "ui-appshell--docs" },
  { title: "List", id: "ui-list--docs" },
  { title: "Button", id: "ui-button--docs" },
  { title: "IconButton", id: "ui-iconbutton--docs" },
  { title: "Input", id: "ui-input--docs" },
  { title: "Textarea", id: "ui-textarea--docs" },
  { title: "Label", id: "ui-label--docs" },
  { title: "Checkbox", id: "ui-checkbox--docs" },
  { title: "Radio", id: "ui-radio--docs" },
  { title: "Switch", id: "ui-switch--docs" },
  { title: "Tabs", id: "ui-tabs--docs" },
  { title: "Select", id: "ui-select--docs" },
  { title: "DropdownMenu", id: "ui-dropdownmenu--docs" },
  { title: "Popover", id: "ui-popover--docs" },
  { title: "Dialog", id: "ui-dialog--docs" },
  { title: "Command", id: "ui-command--docs" },
  { title: "Tooltip", id: "ui-tooltip--docs" },
  { title: "Collapsible", id: "ui-collapsible--docs" },
  { title: "Badge", id: "ui-badge--docs" },
  { title: "Alert", id: "ui-alert--docs" },
  { title: "Status", id: "ui-status--docs" },
  { title: "Pill", id: "ui-pill--docs" },
  { title: "Tag", id: "ui-tag--docs" },
  { title: "FileType", id: "ui-filetype--docs" },
  { title: "Avatar", id: "ui-avatar--docs" },
  { title: "Skeleton", id: "ui-skeleton--docs" },
  { title: "Shimmer", id: "ui-shimmer--docs" },
  { title: "ProgressBar", id: "ui-progressbar--docs" },
  { title: "ScrollFade", id: "ui-scrollfade--docs" },
  { title: "CodeBlock", id: "ui-codeblock--docs" },
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
          <SectionLabel>UI</SectionLabel>
          <NavGrid pages={UI} />
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
