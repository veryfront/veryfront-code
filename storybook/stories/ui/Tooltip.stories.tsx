import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../src/react/components/chat/ui/index.ts";
import {
  PlusIcon,
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

// NOTE: Studio's `Settings`/`Plus` icons are substituted with our
// `WrenchIcon`/`PlusIcon`. Studio's `TooltipArrow` is not exported by our
// barrel (the basic Tooltip has no arrow), so the "With Arrow" example renders
// without it.

const importCode = `import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "veryfront/chat/ui"`;

const compositionTree = `TooltipProvider        <- Context provider (app root)
+-- Tooltip            <- Root per-tooltip instance
    +-- TooltipTrigger <- Element that triggers on hover/focus
    +-- TooltipContent <- Positioned popup with text`;

function TooltipDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Tooltip"
        lead="Hover/focus popup for icon buttons, toolbar actions, and truncated labels."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="With Arrow">
        <DocsExampleAuto of={WithArrow} />
      </DocsSection>

      <DocsSection
        title="Placement"
        description={
          <>
            Set the <code>side</code> prop on <code>TooltipContent</code>.
          </>
        }
      >
        <DocsExampleAuto of={Placement} />
      </DocsSection>

      <DocsSection
        title="Icon Button Toolbar"
        description="One TooltipProvider wraps the group for shared delay."
      >
        <DocsExampleAuto of={IconButtonToolbar} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="TooltipProvider"
          description="Context provider — wrap at app root or around a tooltip group"
          props={[
            {
              name: "delayDuration",
              type: "number",
              default: "700",
              description: "Milliseconds before tooltip shows",
            },
            {
              name: "skipDelayDuration",
              type: "number",
              default: "300",
              description: "Skip delay when moving between triggers",
            },
          ]}
        />
        <DocsPropsTable
          component="Tooltip"
          description="Root wrapper for a single tooltip"
          props={[
            {
              name: "open",
              type: "boolean",
              description: "Controlled open state",
            },
            {
              name: "defaultOpen",
              type: "boolean",
              description: "Initial open state (uncontrolled)",
            },
            {
              name: "onOpenChange",
              type: "(open: boolean) => void",
              description: "Open state change handler",
            },
          ]}
        />
        <DocsPropsTable
          component="TooltipTrigger"
          description="Element that triggers the tooltip on hover/focus"
          props={[
            {
              name: "asChild",
              type: "boolean",
              default: "false",
              description:
                "Merge props onto child element instead of wrapping",
            },
          ]}
        />
        <DocsPropsTable
          component="TooltipContent"
          description="Positioned popup with tooltip text"
          props={[
            {
              name: "side",
              type: "'top' | 'right' | 'bottom' | 'left'",
              default: "'top'",
              description: "Preferred position relative to trigger",
            },
            {
              name: "sideOffset",
              type: "number",
              default: "6",
              description: "Distance from trigger in pixels",
            },
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
  title: "Chat/UI/Tooltip",
  component: Tooltip,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: TooltipDocsPage },
  },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="icon-ghost" size="icon-lg">
          <WrenchIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Settings</TooltipContent>
    </Tooltip>
  ),
};

export const WithArrow: Story = {
  name: "With Arrow",
  tags: ["!dev"],
  render: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="icon-ghost" size="icon-lg">
          <PlusIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        New Project
      </TooltipContent>
    </Tooltip>
  ),
};

export const Placement: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-4">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="default">Top</Button>
        </TooltipTrigger>
        <TooltipContent side="top">Top Tooltip</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="default">Right</Button>
        </TooltipTrigger>
        <TooltipContent side="right">Right Tooltip</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="default">Bottom</Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Bottom Tooltip</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="default">Left</Button>
        </TooltipTrigger>
        <TooltipContent side="left">Left Tooltip</TooltipContent>
      </Tooltip>
    </div>
  ),
};

export const IconButtonToolbar: Story = {
  name: "Icon Button Toolbar",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="icon-ghost" size="icon-lg">
            <PlusIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>New File</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="icon-ghost" size="icon-lg">
            <WrenchIcon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>
    </div>
  ),
};
