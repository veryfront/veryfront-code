import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  AppShell,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  List,
  ListItem,
  ListLabel,
  Tabs,
  TabsItem,
} from "../../../src/react/components/chat/ui/index.ts";
import {
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from "../../../src/react/components/chat/icons/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importCode = `import { AppShell, useAppShell } from "veryfront/chat/ui"`;

const usageCode = `<AppShell storageKey="app-shell">
  <AppShell.Sidebar side="left" aria-label="Conversations">
    <AppShell.SidebarHeader border>New chat</AppShell.SidebarHeader>
    <AppShell.SidebarContent>{/* list */}</AppShell.SidebarContent>
  </AppShell.Sidebar>

  <AppShell.Main>
    <AppShell.Header border>
      <AppShell.Trigger side="left" />
      {/* title / centered tabs / actions */}
      <AppShell.Trigger side="right" />
    </AppShell.Header>
    <AppShell.Content>{/* page */}</AppShell.Content>
  </AppShell.Main>

  <AppShell.Sidebar side="right" aria-label="Details" />
</AppShell>`;

const compositionTree =
  `AppShell                 <- provider + flex layout; owns visibility, ⌘/Ctrl+B, persistence
  +-- AppShell.Sidebar     <- side="left" | "right"; inline on desktop, overlay on mobile
  |    +-- AppShell.SidebarHeader   <- optional border
  |    +-- AppShell.SidebarContent  <- scroll region
  |    +-- AppShell.SidebarFooter   <- optional border
  +-- AppShell.Main        <- the content column
  |    +-- AppShell.Header <- optional top bar, border optional
  |    |    +-- AppShell.Trigger    <- toggle button (Button + side icon, customizable)
  |    +-- AppShell.Content
  +-- AppShell.Sidebar     <- side="right" (independent state + trigger)`;

/** Consistent header-row height so borders align across all columns. */
const HEADER_H = "h-[52px]";

const conversations = [
  "Onboarding flow copy",
  "Pricing page redesign",
  "Q3 launch checklist",
  "Bug: sidebar focus trap",
  "API error taxonomy",
];

/** A "…" menu for a conversation row. */
function RowMenu({ label }: { label: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="icon-ghost"
          size="icon-xs"
          aria-label={`More actions for ${label}`}
        >
          <MoreHorizontalIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        <DropdownMenuItem>
          <PencilIcon />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem className="text-[var(--destructive)]">
          <TrashIcon />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Left rail: New chat button + grouped conversation list. */
function ConversationsSidebar() {
  const [active, setActive] = useState(conversations[0]);
  return (
    <AppShell.Sidebar
      side="left"
      aria-label="Conversations"
      className="border-r border-[var(--outline-border)]"
    >
      <AppShell.SidebarHeader
        className={`flex ${HEADER_H} items-center px-3`}
      >
        <Button variant="primary" size="sm" className="w-full">
          New chat
        </Button>
      </AppShell.SidebarHeader>
      <AppShell.SidebarContent className="p-2">
        <List>
          <ListLabel>Today</ListLabel>
          {conversations.map((title) => (
            <ListItem
              key={title}
              title={title}
              active={title === active}
              onClick={() => setActive(title)}
              action={<RowMenu label={title} />}
            />
          ))}
        </List>
      </AppShell.SidebarContent>
    </AppShell.Sidebar>
  );
}

function PageBody({ children }: { children?: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto p-6 text-sm text-[var(--soft)]">
      {children ?? (
        <>
          <p className="text-[var(--foreground)]">Main content area.</p>
          <p className="mt-2">
            Toggle the sidebar with its button, or press ⌘/Ctrl+B for the left
            rail. Below the <code>sm</code> breakpoint the sidebar becomes a
            focus-trapped overlay.
          </p>
        </>
      )}
    </div>
  );
}

/** Fixed-height, edge-to-edge frame (the docs card is the only border). */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[440px] w-full overflow-hidden bg-[var(--background)]">
      {children}
    </div>
  );
}

function AppShellDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="AppShell"
        lead="A chat-independent layout primitive — a toggleable, accessible, mobile-ready sidebar shell modeled on the shadcn sidebar. Supports a left and a right sidebar, an optional header (with or without a border), keyboard toggle (⌘/Ctrl+B), and per-side persistence. Purely structural: it owns layout, not theming."
      />

      <DocsSection
        title="Default"
        description="A left sidebar plus a bordered header with its toggle. The sidebar is binary — visible or hidden."
      >
        <DocsExampleAuto of={Default} className="!p-0" />
      </DocsSection>

      <DocsSection
        title="Left & Right"
        description="Two independent sidebars with their own triggers, and centered Chat / Attachments tabs in the header. All column borders align."
      >
        <DocsExampleAuto of={LeftAndRight} className="!p-0" />
      </DocsSection>

      <DocsSection
        title="Header border"
        description="AppShell.Header takes an optional border. Same border prop on SidebarHeader / SidebarFooter."
      >
        <DocsExampleAuto of={HeaderBorder} className="!p-0" />
      </DocsSection>

      <DocsSection
        title="Mobile"
        description="Below sm the sidebar renders as a focus-trapped, scroll-locked overlay that slides in from its edge (Escape or backdrop to dismiss). Resize the preview narrow, or use the Storybook viewport toolbar, then toggle."
      >
        <DocsExampleAuto of={Default} className="!p-0" />
      </DocsSection>

      <DocsSection title="Usage">
        <DocsCode code={usageCode} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="AppShell"
          description="Root — provides sidebar state and the flex layout container"
          props={[
            {
              name: "open",
              type: "{ left?: boolean; right?: boolean }",
              description: "Controlled desktop visibility per side",
            },
            {
              name: "defaultOpen",
              type: "{ left?: boolean; right?: boolean }",
              default: "{ left: true, right: false }",
              description: "Uncontrolled initial desktop visibility",
            },
            {
              name: "onOpenChange",
              type: "(side, open: boolean) => void",
              description: "Fires when a side is toggled (desktop)",
            },
            {
              name: "storageKey",
              type: "string",
              description: "localStorage prefix persisting uncontrolled desktop state",
            },
            {
              name: "keyboardShortcut",
              type: "boolean",
              default: "true",
              description: "Toggle the left sidebar with ⌘/Ctrl+B",
            },
          ]}
        />
        <DocsPropsTable
          component="AppShell.Sidebar"
          description="A dockable sidebar — inline column on desktop, overlay on mobile"
          props={[
            {
              name: "side",
              type: '"left" | "right"',
              default: '"left"',
              description: "Edge to dock to",
            },
            {
              name: "width",
              type: "number",
              default: "240",
              description: "Width in px (desktop column + mobile panel)",
            },
            {
              name: "aria-label",
              type: "string",
              default: '"Sidebar"',
              description: "Accessible name for the landmark / dialog",
            },
          ]}
        />
        <DocsPropsTable
          component="AppShell.Header"
          description="Optional top bar inside the main column"
          props={[
            {
              name: "border",
              type: "boolean",
              default: "false",
              description: "Draw a bottom divider",
            },
          ]}
        />
        <DocsPropsTable
          component="AppShell.Trigger"
          description="Toggle button — built on Button; default icon set by side"
          props={[
            {
              name: "side",
              type: '"left" | "right"',
              default: '"left"',
              description: "Which sidebar to toggle",
            },
            {
              name: "icon",
              type: "ReactNode",
              description: "Override the default PanelLeft / PanelRight icon",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/AppShell",
  component: AppShell,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: AppShellDocsPage },
  },
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <Frame>
      <AppShell defaultOpen={{ left: true }}>
        <ConversationsSidebar />
        <AppShell.Main>
          <AppShell.Header border className={`${HEADER_H} px-3`}>
            <AppShell.Trigger side="left" className="text-[var(--faint)]" />
            <span className="ml-1 text-sm font-medium text-[var(--foreground)]">
              Chat
            </span>
          </AppShell.Header>
          <AppShell.Content>
            <PageBody />
          </AppShell.Content>
        </AppShell.Main>
      </AppShell>
    </Frame>
  ),
};

export const LeftAndRight: Story = {
  name: "Left & Right",
  tags: ["!dev"],
  render: () => {
    const [tab, setTab] = useState("chat");
    return (
      <Frame>
        <AppShell defaultOpen={{ left: true, right: true }}>
          <ConversationsSidebar />

          <AppShell.Main>
            <AppShell.Header border className={`${HEADER_H} px-3`}>
              <AppShell.Trigger side="left" className="text-[var(--faint)]" />
              <div className="flex flex-1 justify-center">
                <Tabs value={tab} onValueChange={setTab}>
                  <TabsItem value="chat">Chat</TabsItem>
                  <TabsItem value="attachments">Attachments</TabsItem>
                </Tabs>
              </div>
              <AppShell.Trigger side="right" className="text-[var(--faint)]" />
            </AppShell.Header>
            <AppShell.Content>
              <PageBody>
                <p className="text-[var(--foreground)]">Active tab: {tab}</p>
                <p className="mt-2">
                  Both rails toggle independently — try each button, or ⌘/Ctrl+B
                  for the left.
                </p>
              </PageBody>
            </AppShell.Content>
          </AppShell.Main>

          <AppShell.Sidebar
            side="right"
            width={260}
            aria-label="Details"
            className="border-l border-[var(--outline-border)]"
          >
            <AppShell.SidebarHeader
              className={`flex ${HEADER_H} items-center px-4 text-sm font-medium text-[var(--foreground)]`}
            >
              Details
            </AppShell.SidebarHeader>
            <AppShell.SidebarContent className="p-4 text-sm text-[var(--soft)]">
              A secondary rail for context, inspectors, or metadata.
            </AppShell.SidebarContent>
          </AppShell.Sidebar>
        </AppShell>
      </Frame>
    );
  },
};

export const HeaderBorder: Story = {
  name: "Header border",
  tags: ["!dev"],
  render: () => (
    <div className="divide-y divide-[var(--outline-border)]">
      {([true, false] as const).map((border) => (
        <Frame key={String(border)}>
          <AppShell defaultOpen={{ left: false }} keyboardShortcut={false}>
            <ConversationsSidebar />
            <AppShell.Main>
              <AppShell.Header border={border} className={`${HEADER_H} px-3`}>
                <AppShell.Trigger side="left" className="text-[var(--faint)]" />
                <span className="ml-1 text-sm font-medium text-[var(--foreground)]">
                  {border ? "border" : "no border"}
                </span>
              </AppShell.Header>
              <AppShell.Content>
                <PageBody>
                  <p>
                    Header <code>border={String(border)}</code>.
                  </p>
                </PageBody>
              </AppShell.Content>
            </AppShell.Main>
          </AppShell>
        </Frame>
      ))}
    </div>
  ),
};
