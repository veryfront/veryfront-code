import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemMeta,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../src/react/components/ui/index.ts";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  FileTextIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  WrenchIcon,
} from "../../../src/react/components/ui/icons/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importCode = `import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemMeta,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "veryfront/ui"`;

const compositionTree = `DropdownMenu                          <- Root
+-- DropdownMenuTrigger              <- toggles the menu
+-- DropdownMenuContent              <- panel rendered below the trigger
|   +-- DropdownMenuGroup            <- Groups related items
|   |   +-- DropdownMenuLabel        <- Group heading label
|   |   +-- DropdownMenuItem         <- Menu row
|   |   |   +-- DropdownMenuItemMeta <- Trailing metadata (shortcuts)
|   +-- DropdownMenuSeparator        <- Divider between groups`;

const DESCRIBED_PANEL_GROUPS = [
  {
    label: "Build",
    items: [
      { icon: MessageSquareIcon, title: "Chat" },
      { icon: PanelLeftIcon, title: "Preview" },
    ],
  },
  {
    label: "Content",
    items: [{ icon: FileTextIcon, title: "Code" }],
  },
  {
    label: "Operations",
    items: [{ icon: WrenchIcon, title: "Settings" }],
  },
];

function DescribedPanelGroups() {
  return (
    <>
      {DESCRIBED_PANEL_GROUPS.map((group) => (
        <DropdownMenuGroup key={group.label}>
          <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
          {group.items.map(({ icon: Icon, title }) => (
            <DropdownMenuItem key={title}>
              <Icon />
              <span className="min-w-0 flex-1 truncate text-base font-normal">
                {title}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      ))}
    </>
  );
}

function DropdownMenuDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="DropdownMenu"
        lead="Desktop action menus and option pickers opened from a trigger button."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Minimal} />
      </DocsSection>

      <DocsSection title="With Labels and Separators">
        <DocsExampleAuto of={WithLabelsAndSeparators} />
      </DocsSection>

      <DocsSection title="With Item Icons">
        <DocsExampleAuto of={WithIcons} />
      </DocsSection>

      <DocsSection title="With Groups">
        <DocsExampleAuto of={WithGroups} />
      </DocsSection>

      <DocsSection title="With Keyboard Shortcuts">
        <DocsExampleAuto of={WithKeyboardShortcuts} />
      </DocsSection>

      <DocsSection
        title="Scrollable Content"
        description="Remove default padding and wrap items in a scroll container."
      >
        <DocsExampleAuto of={WithScrollableContent} />
      </DocsSection>

      <DocsSection title="Real-world: Action Menu">
        <DocsExampleAuto of={ActionMenu} />
      </DocsSection>

      <DocsSection title="With Row Actions">
        <DocsExampleAuto of={WithRowActions} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="DropdownMenu"
          description="Root"
          props={[
            { name: "open", type: "boolean", description: "Controlled open state" },
            { name: "defaultOpen", type: "boolean", default: "false", description: "Uncontrolled initial open state" },
            { name: "onOpenChange", type: "(open) => void", description: "Open-state change handler" },
          ]}
        />
        <DocsPropsTable
          component="DropdownMenuContent"
          description="Panel rendered below the trigger"
          props={[
            { name: "align", type: "'start' | 'end'", default: "'start'", description: "Horizontal alignment relative to the trigger" },
            { name: "className", type: "string", description: "Additional classes" },
          ]}
        />
        <DocsPropsTable
          component="DropdownMenuItem"
          description="Menu row"
          props={[
            { name: "onSelect", type: "() => void", description: "Chosen handler (also closes the menu)" },
            { name: "asChild", type: "boolean", default: "false", description: "Merge item styling onto your own element" },
            { name: "disabled", type: "boolean", description: "Disables the item" },
          ]}
        />
        <DocsPropsTable
          component="DropdownMenuLabel"
          description="Group heading label"
          props={[{ name: "children", type: "ReactNode", description: "Label content" }]}
        />
        <DocsPropsTable
          component="DropdownMenuSeparator"
          description="Divider between groups"
          props={[{ name: "className", type: "string", description: "Additional classes" }]}
        />
        <DocsPropsTable
          component="DropdownMenuItemMeta"
          description="Trailing metadata text (keyboard shortcuts, badges)"
          props={[{ name: "children", type: "ReactNode", description: "Metadata content" }]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/DropdownMenu",
  component: DropdownMenu,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: DropdownMenuDocsPage },
  },
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Minimal: Story = {
  tags: ["!dev"],
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          Options
          <ChevronDownIcon className="!size-4 !ml-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
          <DropdownMenuItem>Share</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const WithIcons: Story = {
  name: "With Icons",
  tags: ["!dev"],
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">Menu</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <MessageSquareIcon /> Chat
          </DropdownMenuItem>
          <DropdownMenuItem>
            <FileTextIcon /> Projects
          </DropdownMenuItem>
          <DropdownMenuItem>
            <WrenchIcon /> Settings
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>
            <ArrowRightIcon /> Log Out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const WithGroups: Story = {
  name: "With Groups",
  tags: ["!dev"],
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">Panels</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[280px]">
        <DescribedPanelGroups />
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const WithScrollableContent: Story = {
  name: "With Scrollable Content",
  tags: ["!dev"],
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="icon-secondary" size="icon-lg">
          <MessageSquareIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[280px] p-0">
        <div className="max-h-[240px] overflow-y-auto scrollbar-none">
          <div className="p-2.5">
            <DescribedPanelGroups />
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const WithLabelsAndSeparators: Story = {
  name: "With Labels and Separators",
  tags: ["!dev"],
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="default">
          Options
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Danger Zone</DropdownMenuLabel>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const WithKeyboardShortcuts: Story = {
  name: "With Keyboard Shortcuts",
  tags: ["!dev"],
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="default">
          Options
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuItem>
            Edit
            <DropdownMenuItemMeta>Cmd+E</DropdownMenuItemMeta>
          </DropdownMenuItem>
          <DropdownMenuItem>
            Duplicate
            <DropdownMenuItemMeta>Cmd+D</DropdownMenuItemMeta>
          </DropdownMenuItem>
          <DropdownMenuItem>
            Delete
            <DropdownMenuItemMeta>Del</DropdownMenuItemMeta>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const WithRowActions: Story = {
  name: "With Row Actions",
  tags: ["!dev"],
  render: () => {
    const items = [
      { id: "1", label: "Untitled conversation" },
      { id: "2", label: "Design system audit" },
      { id: "3", label: "Onboarding flow notes" },
      { id: "4", label: "Marketing site copy" },
    ];
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">
            Conversations
            <ChevronDownIcon className="!size-4 !ml-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[280px]">
          <DropdownMenuGroup>
            {items.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={() => {}} asChild>
                <div className="group flex w-full items-center gap-2">
                  <span className="flex-1 truncate">{item.label}</span>
                  <div className="-mr-1.5 ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 touch:opacity-100">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="icon-ghost"
                          size="icon-sm"
                          aria-label="More actions"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <PanelLeftIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <DropdownMenuGroup>
                          <DropdownMenuItem>Rename</DropdownMenuItem>
                          <DropdownMenuItem>Pin</DropdownMenuItem>
                          <DropdownMenuItem>Delete</DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  },
};

export const ActionMenu: Story = {
  name: "Action Menu",
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="icon-secondary" size="icon-lg">
      <Ellipsis />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuGroup>
      <DropdownMenuItem onSelect={onEdit}>Edit</DropdownMenuItem>
      <DropdownMenuItem onSelect={onDuplicate}>Duplicate</DropdownMenuItem>
    </DropdownMenuGroup>
    <DropdownMenuSeparator />
    <DropdownMenuGroup>
      <DropdownMenuItem onSelect={onDelete}>Delete</DropdownMenuItem>
    </DropdownMenuGroup>
  </DropdownMenuContent>
</DropdownMenu>`,
      },
    },
  },
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="icon-secondary" size="icon-lg">
          <MessageSquareIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem>Edit</DropdownMenuItem>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
