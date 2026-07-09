import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconButton,
  TooltipProvider,
} from "../../../src/react/components/ui/index.ts";
import {
  CopyIcon,
  PlusIcon,
  RefreshCwIcon,
  TrashIcon,
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

// NOTE: Studio's `Plus`/`Copy`/`RefreshCw`/`Trash2` icons are substituted with
// our `PlusIcon`/`CopyIcon`/`RefreshCwIcon`/`TrashIcon`.

const importCode = `import { IconButton } from "veryfront/ui"`;

const compositionTree = `IconButton
+-- Tooltip
    +-- TooltipTrigger -> Button
    +-- TooltipContent`;

function IconButtonDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="IconButton"
        lead="Icon-only button with a built-in tooltip."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="Secondary"
        description="Higher-emphasis actions like copy."
      >
        <DocsExampleAuto of={Secondary} />
      </DocsSection>

      <DocsSection
        title="Disabled"
        description="Tooltip is suppressed when disabled."
      >
        <DocsExampleAuto of={Disabled} />
      </DocsSection>

      <DocsSection title="Toolbar Row">
        <DocsExampleAuto of={ToolbarRow} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="IconButton"
          description="Icon button with built-in tooltip (extends ButtonProps)"
          props={[
            {
              name: "tooltip",
              type: "string",
              description: "Hover label (required)",
            },
            {
              name: "tooltipSide",
              type: "'top' | 'bottom' | 'left' | 'right'",
              default: "'bottom'",
              description: "Which side the tooltip appears on",
            },
            {
              name: "variant",
              type: "'icon-primary' | 'icon-secondary' | 'icon-ghost' | …",
              description: "Button icon variant",
            },
            {
              name: "disabled",
              type: "boolean",
              default: "false",
              description: "Disable the button (tooltip is suppressed)",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/IconButton",
  component: IconButton,
  tags: ["autodocs"],
  args: {
    tooltip: "Tooltip",
  },
  parameters: {
    layout: "centered",
    docs: { page: IconButtonDocsPage },
  },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <IconButton tooltip="Add item" variant="icon-ghost" size="icon-sm">
      <PlusIcon />
    </IconButton>
  ),
};

export const Secondary: Story = {
  tags: ["!dev"],
  render: () => (
    <IconButton
      tooltip="Copy to clipboard"
      variant="icon-secondary"
      size="icon-sm"
    >
      <CopyIcon />
    </IconButton>
  ),
};

export const Disabled: Story = {
  tags: ["!dev"],
  render: () => (
    <IconButton tooltip="Refresh" variant="icon-ghost" size="icon-sm" disabled>
      <RefreshCwIcon />
    </IconButton>
  ),
};

export const ToolbarRow: Story = {
  name: "Toolbar Row",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-1">
      <IconButton tooltip="Refresh" variant="icon-ghost" size="icon-sm">
        <RefreshCwIcon />
      </IconButton>
      <IconButton tooltip="Delete" variant="icon-ghost" size="icon-sm">
        <TrashIcon />
      </IconButton>
    </div>
  ),
};
