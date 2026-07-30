import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "../../../src/react/components/ui/menubar.tsx";

const importCode = `import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "veryfront/ui"`;

function MenubarDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Menubar"
        lead="A horizontal bar of menu buttons — File / Edit / View — where each button opens a dropdown and ArrowLeft / ArrowRight move between them."
      />

      <DocsSection
        title="Default"
        description="Click a trigger to open its menu; only one menu is open at a time."
      >
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="With separators"
        description="Group related items inside a menu with MenubarSeparator."
      >
        <DocsExampleAuto of={WithSeparators} />
      </DocsSection>

      <DocsSection
        title="Disabled items"
        description="Individual items can be disabled and stay non-interactive."
      >
        <DocsExampleAuto of={DisabledItems} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>
          Menubar · MenubarMenu · MenubarTrigger · MenubarContent · MenubarItem · MenubarSeparator
        </DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Menubar"
          description="Horizontal bar container; owns which menu is open and roving focus"
          props={[
            {
              name: "children",
              type: "React.ReactNode",
              description: "The MenubarMenu children that make up the bar",
            },
          ]}
        />
        <DocsPropsTable
          component="MenubarMenu"
          description="One menu in the bar — a DropdownMenu the bar controls"
          props={[
            {
              name: "children",
              type: "React.ReactNode",
              description: "The MenubarTrigger and MenubarContent for this menu",
            },
            {
              name: "value",
              type: "string",
              description: "Stable identifier for this menu; auto-generated when omitted",
            },
          ]}
        />
        <DocsPropsTable
          component="MenubarTrigger"
          description="Top-level menu button (role=menuitem, aria-haspopup)"
          props={[
            {
              name: "children",
              type: "React.ReactNode",
              description: "The trigger label, e.g. 'File' or 'Edit'",
            },
          ]}
        />
        <DocsPropsTable
          component="MenubarItem"
          description="A selectable item inside a menu"
          props={[
            {
              name: "onSelect",
              type: "() => void",
              description: "Called when the item is chosen (also closes the menu)",
            },
            {
              name: "disabled",
              type: "boolean",
              description: "Disable the item, making it non-interactive",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Menubar",
  component: Menubar,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: MenubarDocsPage },
  },
} satisfies Meta<typeof Menubar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>New Tab</MenubarItem>
          <MenubarItem>New Window</MenubarItem>
          <MenubarItem>Open…</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>Undo</MenubarItem>
          <MenubarItem>Redo</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>View</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>Zoom In</MenubarItem>
          <MenubarItem>Zoom Out</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  ),
};

export const WithSeparators: Story = {
  tags: ["!dev"],
  render: () => (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>File</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>New</MenubarItem>
          <MenubarItem>Open…</MenubarItem>
          <MenubarSeparator />
          <MenubarItem>Save</MenubarItem>
          <MenubarItem>Save As…</MenubarItem>
          <MenubarSeparator />
          <MenubarItem>Close</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Help</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>Documentation</MenubarItem>
          <MenubarItem>About</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  ),
};

export const DisabledItems: Story = {
  tags: ["!dev"],
  render: () => (
    <Menubar>
      <MenubarMenu>
        <MenubarTrigger>Edit</MenubarTrigger>
        <MenubarContent>
          <MenubarItem>Cut</MenubarItem>
          <MenubarItem>Copy</MenubarItem>
          <MenubarItem disabled>Paste</MenubarItem>
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  ),
};
