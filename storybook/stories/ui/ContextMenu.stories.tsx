import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../../src/react/components/ui/context-menu.tsx";
import {
  ArrowRightIcon,
  FileTextIcon,
  MessageSquareIcon,
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "veryfront/ui"`;

const compositionTree = `ContextMenu                     <- Root (owns open + pointer position)
+-- ContextMenuTrigger          <- right-click region (contextmenu event)
+-- ContextMenuContent          <- panel portalled at the pointer
|   +-- ContextMenuGroup        <- Groups related items
|   |   +-- ContextMenuLabel    <- Group heading label
|   |   +-- ContextMenuItem     <- Menu row (closes on select)
|   +-- ContextMenuSeparator    <- Divider between groups`;

const triggerClass =
  "flex h-[140px] w-[320px] select-none items-center justify-center rounded-lg border border-dashed border-[var(--edge-medium)] text-sm text-[var(--foreground)] opacity-70";

function ContextMenuDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ContextMenu"
        lead="A menu opened by right-click at the pointer position, sharing DropdownMenu's surface and item styling."
      />

      <DocsSection title="Default" description="Right-click the region to open the menu at the pointer.">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="With Labels and Separators">
        <DocsExampleAuto of={WithLabelsAndSeparators} />
      </DocsSection>

      <DocsSection title="With Item Icons">
        <DocsExampleAuto of={WithIcons} />
      </DocsSection>

      <DocsSection title="With Disabled Item">
        <DocsExampleAuto of={WithDisabledItem} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ContextMenu"
          description="Root"
          props={[
            { name: "open", type: "boolean", description: "Controlled open state" },
            { name: "defaultOpen", type: "boolean", default: "false", description: "Uncontrolled initial open state" },
            { name: "onOpenChange", type: "(open) => void", description: "Open-state change handler" },
          ]}
        />
        <DocsPropsTable
          component="ContextMenuTrigger"
          description="Right-click region"
          props={[
            { name: "asChild", type: "boolean", default: "false", description: "Merge trigger behaviour onto your own element" },
            { name: "className", type: "string", description: "Additional classes" },
          ]}
        />
        <DocsPropsTable
          component="ContextMenuContent"
          description="Panel portalled at the pointer position"
          props={[
            { name: "align", type: "'start' | 'end'", default: "'start'", description: "Horizontal edge aligned to the pointer" },
            { name: "className", type: "string", description: "Additional classes" },
          ]}
        />
        <DocsPropsTable
          component="ContextMenuItem"
          description="Menu row"
          props={[
            { name: "onSelect", type: "() => void", description: "Chosen handler (also closes the menu)" },
            { name: "asChild", type: "boolean", default: "false", description: "Merge item styling onto your own element" },
            { name: "disabled", type: "boolean", description: "Disables the item" },
          ]}
        />
        <DocsPropsTable
          component="ContextMenuLabel"
          description="Group heading label"
          props={[{ name: "children", type: "ReactNode", description: "Label content" }]}
        />
        <DocsPropsTable
          component="ContextMenuSeparator"
          description="Divider between groups"
          props={[{ name: "className", type: "string", description: "Additional classes" }]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/ContextMenu",
  component: ContextMenu,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: ContextMenuDocsPage },
  },
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className={triggerClass}>
        Right-click here
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem>Cut</ContextMenuItem>
          <ContextMenuItem>Copy</ContextMenuItem>
          <ContextMenuItem>Paste</ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  ),
};

export const WithLabelsAndSeparators: Story = {
  name: "With Labels and Separators",
  tags: ["!dev"],
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className={triggerClass}>
        Right-click here
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuLabel>Actions</ContextMenuLabel>
          <ContextMenuItem>Edit</ContextMenuItem>
          <ContextMenuItem>Duplicate</ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuLabel>Danger Zone</ContextMenuLabel>
          <ContextMenuItem>Delete</ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  ),
};

export const WithIcons: Story = {
  name: "With Icons",
  tags: ["!dev"],
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className={triggerClass}>
        Right-click here
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem>
            <MessageSquareIcon /> Comment
          </ContextMenuItem>
          <ContextMenuItem>
            <FileTextIcon /> Rename
          </ContextMenuItem>
          <ContextMenuItem>
            <WrenchIcon /> Settings
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem>
            <ArrowRightIcon /> Move
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  ),
};

export const WithDisabledItem: Story = {
  name: "With Disabled Item",
  tags: ["!dev"],
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className={triggerClass}>
        Right-click here
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem>Cut</ContextMenuItem>
          <ContextMenuItem>Copy</ContextMenuItem>
          <ContextMenuItem disabled>Paste</ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  ),
};
