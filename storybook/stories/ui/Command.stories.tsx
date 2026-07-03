import type { Meta, StoryObj } from "@storybook/react-vite";
import React, { useState } from "react";
import {
  Button,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "../../../src/react/components/chat/ui/index.ts";
import {
  BrainIcon,
  CheckIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  SearchIcon,
  SparklesIcon,
  WrenchIcon,
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

const importCode = `import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandItemContent,
  CommandItemDescription,
  CommandItemTitle,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "veryfront/chat/ui"`;

const compositionTree =
  `Command                              <- Root container
+-- CommandInput                    <- Search input with bottom border
|   icon?                           <- Optional leading icon
+-- CommandList                     <- Scrollable list container
|   +-- CommandEmpty                <- Shown when no results match
|   +-- CommandGroup                <- Groups items with heading label
|   |   +-- CommandItem             <- Selectable row
|   |   |   +-- CommandItemContent  <- Flex column wrapper for multi-line items
|   |   |   |   +-- CommandItemTitle       <- Primary text
|   |   |   |   +-- CommandItemDescription <- Secondary text
|   |   |   +-- CommandShortcut     <- Right-aligned shortcut label
|   +-- CommandSeparator            <- Divider between groups
CommandDialog                        <- Command inside a Dialog overlay`;

const customFilterCode =
  `<Command filter={(value, search) => {
  // Custom fuzzy search with Fuse.js or similar
  return fuse.search(search).some(r => r.item === value) ? 1 : 0
}}>
  <CommandInput placeholder="Find a font..." />
  <CommandList>
    {fonts.map(font => (
      <CommandItem key={font} value={font} onSelect={handleSelect}>
        {font}
      </CommandItem>
    ))}
  </CommandList>
</Command>`;

function CommandDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Command"
        lead="Searchable command menu for palettes, model pickers, and filtered lists."
      />
      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>
      <DocsSection title="Without Groups">
        <DocsExampleAuto of={WithoutGroups} />
      </DocsSection>
      <DocsSection title="With Search Icon">
        <DocsExampleAuto of={WithSearchIcon} />
      </DocsSection>
      <DocsSection title="With Groups and Separator">
        <DocsExampleAuto of={WithGroups} />
      </DocsSection>
      <DocsSection title="Rich Items with Icons">
        <DocsExampleAuto of={WithIcons} />
      </DocsSection>
      <DocsSection
        title="Model Picker (Inside Popover)"
        description="Inside a Popover, set bg-transparent so the parent surface shows through."
      >
        <DocsExampleAuto of={ModelPicker} />
      </DocsSection>
      <DocsSection title="Disabled Items">
        <DocsExampleAuto of={WithDisabledItems} />
      </DocsSection>
      <DocsSection title="In Dialog">
        <DocsExampleAuto of={InDialog} />
      </DocsSection>
      <DocsSection
        title="In Drawer (mobile)"
        description="Compose Command inside a Drawer for mobile palettes. The list uses variant='flush' so the drawer padding wraps the items."
      >
        <DocsExampleAuto of={InDrawer} />
      </DocsSection>
      <DocsSection
        title="Custom Filter"
        description="Custom filter for fuzzy search over large datasets."
      >
        <DocsCode code={customFilterCode} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>
      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Command"
          description="Root container — owns the filter query"
          props={[
            { name: "children", type: "ReactNode", description: "Input + list" },
            { name: "className", type: "string", description: "Additional classes" },
          ]}
        />
        <DocsPropsTable
          component="CommandInput"
          description="Search input with bottom border"
          props={[
            { name: "icon", type: "ReactNode", description: "Optional leading icon (defaults to a search glyph)" },
            { name: "placeholder", type: "string", description: "Input placeholder" },
          ]}
        />
        <DocsPropsTable
          component="CommandItem"
          description="Selectable row"
          props={[
            { name: "value", type: "string", description: "Searchable text used for filtering" },
            { name: "onSelect", type: "(value) => void", description: "Chosen handler" },
            { name: "disabled", type: "boolean", description: "Non-interactive row" },
          ]}
        />
        <DocsPropsTable
          component="CommandGroup"
          description="Groups items with a heading label"
          props={[
            { name: "heading", type: "ReactNode", description: "Group label (auto-hides when all items filtered out)" },
          ]}
        />
        <DocsPropsTable
          component="CommandDialog"
          description="Command inside a Dialog overlay"
          props={[
            { name: "open / defaultOpen", type: "boolean", description: "Controlled / uncontrolled state" },
            { name: "onOpenChange", type: "(open) => void", description: "Open-state callback" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Command",
  component: Command,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: CommandDocsPage } },
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="w-[280px]">{children}</div>;
}

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <Frame>
      <Command>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Suggestions">
            <CommandItem>
              Calendar
              <CommandShortcut>⌘K</CommandShortcut>
            </CommandItem>
            <CommandItem>Search Emoji</CommandItem>
            <CommandItem>Calculator</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </Frame>
  ),
};

export const WithoutGroups: Story = {
  name: "Without Groups",
  tags: ["!dev"],
  render: () => (
    <Frame>
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandItem>Dashboard</CommandItem>
          <CommandItem>Settings</CommandItem>
          <CommandItem>Profile</CommandItem>
          <CommandItem>Billing</CommandItem>
        </CommandList>
      </Command>
    </Frame>
  ),
};

export const WithSearchIcon: Story = {
  name: "With Search Icon",
  tags: ["!dev"],
  render: () => (
    <Frame>
      <Command>
        <CommandInput icon={<SearchIcon className="size-4" />} placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Results">
            <CommandItem>Dashboard</CommandItem>
            <CommandItem>Settings</CommandItem>
            <CommandItem>Profile</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </Frame>
  ),
};

export const WithGroups: Story = {
  name: "With Groups",
  tags: ["!dev"],
  render: () => (
    <Frame>
      <Command>
        <CommandInput placeholder="Search commands..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Suggestions">
            <CommandItem>Calendar</CommandItem>
            <CommandItem>Search Emoji</CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Settings">
            <CommandItem>Profile</CommandItem>
            <CommandItem>Billing</CommandItem>
            <CommandItem>Subscription</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </Frame>
  ),
};

export const WithIcons: Story = {
  name: "Rich Items with Icons",
  tags: ["!dev"],
  render: () => (
    <Frame>
      <Command>
        <CommandInput placeholder="Search panels..." />
        <CommandList>
          <CommandEmpty>No panels found.</CommandEmpty>
          <CommandGroup heading="Build">
            <CommandItem>
              <MessageSquareIcon />
              <span className="min-w-0 flex-1 truncate text-base font-normal">Chat</span>
            </CommandItem>
            <CommandItem>
              <PanelLeftIcon />
              <span className="min-w-0 flex-1 truncate text-base font-normal">Preview</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Operations">
            <CommandItem>
              <WrenchIcon />
              <span className="min-w-0 flex-1 truncate text-base font-normal">Settings</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </Frame>
  ),
};

const models = [
  { id: "opus", name: "Claude Opus", provider: "anthropic" },
  { id: "sonnet", name: "Claude Sonnet", provider: "anthropic" },
  { id: "haiku", name: "Claude Haiku", provider: "anthropic" },
  { id: "gpt5", name: "GPT-5.2", provider: "openai" },
];

export const ModelPicker: Story = {
  name: "Model Picker",
  tags: ["!dev"],
  render: () => {
    const [selected, setSelected] = useState("haiku");
    return (
      <Frame>
        <Command>
          <CommandInput placeholder="Search models..." />
          <CommandList className="max-h-[320px]">
            <CommandEmpty>No models found.</CommandEmpty>
            <CommandGroup heading="Anthropic">
              {models.filter((m) => m.provider === "anthropic").map((model) => (
                <CommandItem
                  key={model.id}
                  value={model.name}
                  onSelect={() => setSelected(model.id)}
                >
                  <BrainIcon />
                  <span className="min-w-0 flex-1 truncate text-base font-normal">
                    {model.name}
                  </span>
                  {model.id === selected && (
                    <CheckIcon className="text-[var(--primary)] ml-auto shrink-0" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="OpenAI">
              {models.filter((m) => m.provider === "openai").map((model) => (
                <CommandItem
                  key={model.id}
                  value={model.name}
                  onSelect={() => setSelected(model.id)}
                >
                  <SparklesIcon />
                  <span className="min-w-0 flex-1 truncate text-base font-normal">
                    {model.name}
                  </span>
                  {model.id === selected && (
                    <CheckIcon className="text-[var(--primary)] ml-auto shrink-0" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </Frame>
    );
  },
};

export const WithDisabledItems: Story = {
  name: "Disabled Items",
  tags: ["!dev"],
  render: () => (
    <Frame>
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem>New File</CommandItem>
            <CommandItem disabled>Open Recent (unavailable)</CommandItem>
            <CommandItem>Save</CommandItem>
            <CommandItem disabled>Print (unavailable)</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </Frame>
  ),
};

export const InDialog: Story = {
  name: "In Dialog",
  tags: ["!dev"],
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Open Command Palette</Button>
        <CommandDialog open={open} onOpenChange={setOpen}>
          <CommandInput placeholder="Type a command or search..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Quick Actions">
              <CommandItem onSelect={() => setOpen(false)}>
                New File
                <CommandShortcut>⌘N</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                Open File
                <CommandShortcut>⌘O</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>
                Save
                <CommandShortcut>⌘S</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Navigation">
              <CommandItem onSelect={() => setOpen(false)}>Dashboard</CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>Projects</CommandItem>
              <CommandItem onSelect={() => setOpen(false)}>Settings</CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </div>
    );
  },
};

export const InDrawer: Story = {
  name: "In Drawer",
  tags: ["!dev"],
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Open Command Drawer</Button>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent className="bg-[var(--secondary)] text-[var(--foreground)]">
            <DrawerTitle className="sr-only">Command palette</DrawerTitle>
            <Command className="bg-transparent">
              <CommandInput
                icon={<SearchIcon className="size-4" />}
                placeholder="Type a command or search..."
              />
              <div className="px-4.5 py-2">
                <CommandList variant="flush" className="max-h-[min(60vh,420px)]">
                  <CommandEmpty>No results found.</CommandEmpty>
                  <CommandGroup heading="Actions">
                    <CommandItem onSelect={() => setOpen(false)}>
                      New File
                      <CommandShortcut>⌘N</CommandShortcut>
                    </CommandItem>
                    <CommandItem onSelect={() => setOpen(false)}>Open Project</CommandItem>
                    <CommandItem onSelect={() => setOpen(false)}>Deploy</CommandItem>
                  </CommandGroup>
                  <CommandGroup heading="Settings">
                    <CommandItem onSelect={() => setOpen(false)}>Theme</CommandItem>
                    <CommandItem onSelect={() => setOpen(false)}>Keybindings</CommandItem>
                  </CommandGroup>
                </CommandList>
              </div>
            </Command>
          </DrawerContent>
        </Drawer>
      </div>
    );
  },
};
