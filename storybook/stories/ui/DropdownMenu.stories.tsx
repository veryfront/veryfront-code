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
} from "../../../src/react/components/chat/ui/index.ts";
import {
  ChevronDownIcon,
  CopyIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
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

const importCode =
  `import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuGroup, DropdownMenuItem, DropdownMenuItemMeta,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "veryfront/chat/ui"`;

const compositionTree =
  `DropdownMenu              <- owns open state + anchor
  +-- DropdownMenuTrigger      <- button (asChild merges onto your element)
  +-- DropdownMenuContent      <- surface below the trigger; outside-click / Escape dismiss
       +-- DropdownMenuGroup        <- groups related items (tight gap)
            +-- DropdownMenuLabel       <- section heading
            +-- DropdownMenuItem        <- selectable row (closes on select)
            |    +-- DropdownMenuItemMeta  <- trailing shortcut / count
            +-- DropdownMenuSeparator   <- divider`;

function DropdownMenuDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="DropdownMenu"
        lead="Action menu anchored to a trigger — the composer `+`, message actions, model picker. Basic behavior (outside-click / Escape dismiss); full keyboard a11y is TODO."
      />
      <DocsSection title="Default" description="Click the trigger to open.">
        <DocsExampleAuto of={Default} />
      </DocsSection>
      <DocsSection
        title="With Labels and Separators"
        description="Group rows under labels and divide with a separator."
      >
        <DocsExampleAuto of={WithLabelsAndSeparators} />
      </DocsSection>
      <DocsSection title="With Icons" description="Leading icons render at 16px.">
        <DocsExampleAuto of={WithIcons} />
      </DocsSection>
      <DocsSection
        title="With Keyboard Shortcuts"
        description="Trailing metadata via DropdownMenuItemMeta."
      >
        <DocsExampleAuto of={WithKeyboardShortcuts} />
      </DocsSection>
      <DocsSection
        title="Action Menu"
        description="Icon trigger, end-aligned — the real-world pattern."
      >
        <DocsExampleAuto of={ActionMenu} />
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
          props={[
            { name: "open", type: "boolean", description: "Controlled open state" },
            { name: "defaultOpen", type: "boolean", default: "false", description: "Uncontrolled initial state" },
            { name: "onOpenChange", type: "(open) => void", description: "Open-state callback" },
          ]}
        />
        <DocsPropsTable
          component="DropdownMenuContent"
          props={[
            { name: "align", type: "'start' | 'end'", default: "'start'", description: "Horizontal alignment to the trigger" },
          ]}
        />
        <DocsPropsTable
          component="DropdownMenuItem"
          props={[
            { name: "onSelect", type: "() => void", description: "Chosen handler (also closes the menu)" },
            { name: "asChild", type: "boolean", description: "Merge item styling onto your own element" },
            { name: "disabled", type: "boolean", description: "Non-interactive row" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/DropdownMenu",
  component: DropdownMenu,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: DropdownMenuDocsPage } },
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Minimal menu opened from a labelled button. */
export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex h-56 items-start justify-center pt-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">
            Options
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuItem>Share</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
};

/** Labelled groups split by a full-width separator. */
export const WithLabelsAndSeparators: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex h-64 items-start justify-center pt-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">Options</Button>
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
            <DropdownMenuItem className="text-[var(--destructive)]">
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
};

/** Leading icons sized to match the row text. */
export const WithIcons: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex h-64 items-start justify-center pt-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">Menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem>
              <CopyIcon />
              Copy
            </DropdownMenuItem>
            <DropdownMenuItem>
              <PencilIcon />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem>
              <RefreshCwIcon />
              Regenerate
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem className="text-[var(--destructive)]">
              <TrashIcon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
};

/** Trailing keyboard hints via DropdownMenuItemMeta. */
export const WithKeyboardShortcuts: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex h-60 items-start justify-center pt-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">Options</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            <DropdownMenuItem>
              Edit
              <DropdownMenuItemMeta>⌘E</DropdownMenuItemMeta>
            </DropdownMenuItem>
            <DropdownMenuItem>
              Duplicate
              <DropdownMenuItemMeta>⌘D</DropdownMenuItemMeta>
            </DropdownMenuItem>
            <DropdownMenuItem>
              Delete
              <DropdownMenuItemMeta>⌫</DropdownMenuItemMeta>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
};

/** Circular icon trigger, end-aligned — the composer `+` / row-actions pattern. */
export const ActionMenu: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex h-64 items-start justify-center pt-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="icon-secondary" size="icon-default" aria-label="Add">
            <PlusIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Actions</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem>
              <CopyIcon />
              Copy
            </DropdownMenuItem>
            <DropdownMenuItem>
              <PencilIcon />
              Edit
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem className="text-[var(--destructive)]">
              <TrashIcon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
};
