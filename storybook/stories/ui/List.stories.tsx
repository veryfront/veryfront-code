import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  List,
  ListItem,
  ListLabel,
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

const importCode = `import { List, ListLabel, ListItem } from "veryfront/chat/ui"`;

const compositionTree =
  `List             <- container (tight vertical rhythm)
  +-- ListLabel    <- uppercase section heading (date groups etc.)
  +-- ListItem     <- row: padding / rounded / hover + active
       |               title, optional description, optional action slot`;

/** A "…" menu for the trailing action slot. */
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

const conversations = [
  "Onboarding flow copy",
  "Pricing page redesign",
  "Q3 launch checklist",
  "Bug: sidebar focus trap",
  "API error taxonomy",
];

function ListDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="List"
        lead="A primitive for vertical item lists — sidebars, thread rails, nav groups. Rows carry padding, rounded corners, and subtle hover / active states (the chrome `--accent` tint, not a white fill), with an optional description line and a trailing action slot revealed on hover."
      />

      <DocsSection
        title="Default"
        description="A labelled group of rows, one active. Hover reveals the subtle accent tint."
      >
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="With action"
        description="A trailing “…” menu that appears on hover (or while active). Its clicks don't select the row."
      >
        <DocsExampleAuto of={WithAction} />
      </DocsSection>

      <DocsSection
        title="With description"
        description="Optional secondary line under the title."
      >
        <DocsExampleAuto of={WithDescription} />
      </DocsSection>

      <DocsSection
        title="Grouped by date"
        description="ListLabel doubles as a date heading."
      >
        <DocsExampleAuto of={Grouped} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ListItem"
          description="A single row — clickable, with optional description + trailing action"
          props={[
            {
              name: "title",
              type: "ReactNode",
              description: "Primary line (truncates). Omit to render children instead",
            },
            {
              name: "description",
              type: "ReactNode",
              description: "Optional secondary line under the title",
            },
            {
              name: "active",
              type: "boolean",
              default: "false",
              description: "Highlight as the current/selected row",
            },
            {
              name: "action",
              type: "ReactNode",
              description: "Trailing slot (e.g. a menu), revealed on hover / when active",
            },
          ]}
        />
        <DocsPropsTable
          component="ListLabel"
          description="Uppercase section heading — use for date groups"
          props={[
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/List",
  component: List,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: ListDocsPage },
  },
} satisfies Meta<typeof List>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => {
    const [active, setActive] = useState(conversations[0]);
    return (
      <List className="w-64">
        <ListLabel>Today</ListLabel>
        {conversations.map((title) => (
          <ListItem
            key={title}
            title={title}
            active={title === active}
            onClick={() => setActive(title)}
          />
        ))}
      </List>
    );
  },
};

export const WithAction: Story = {
  name: "With action",
  tags: ["!dev"],
  render: () => {
    const [active, setActive] = useState(conversations[0]);
    return (
      <List className="w-64">
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
    );
  },
};

export const WithDescription: Story = {
  name: "With description",
  tags: ["!dev"],
  render: () => (
    <List className="w-72">
      <ListLabel>Projects</ListLabel>
      <ListItem
        title="Onboarding flow copy"
        description="Edited 2h ago · 12 messages"
        active
        action={<RowMenu label="Onboarding flow copy" />}
      />
      <ListItem
        title="Pricing page redesign"
        description="Edited yesterday · 4 messages"
        action={<RowMenu label="Pricing page redesign" />}
      />
      <ListItem
        title="Q3 launch checklist"
        description="Edited 3d ago · 27 messages"
        action={<RowMenu label="Q3 launch checklist" />}
      />
    </List>
  ),
};

export const Grouped: Story = {
  name: "Grouped by date",
  tags: ["!dev"],
  render: () => (
    <List className="w-64">
      <ListLabel>Today</ListLabel>
      <ListItem title="Onboarding flow copy" active />
      <ListItem title="Pricing page redesign" />
      <div className="pt-2" />
      <ListLabel>Yesterday</ListLabel>
      <ListItem title="Q3 launch checklist" />
      <ListItem title="Bug: sidebar focus trap" />
      <div className="pt-2" />
      <ListLabel>Previous 7 days</ListLabel>
      <ListItem title="API error taxonomy" />
    </List>
  ),
};
