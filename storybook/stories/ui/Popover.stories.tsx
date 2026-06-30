import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Button,
  Popover,
  PopoverActions,
  PopoverBody,
  PopoverContent,
  PopoverFooter,
  PopoverTitle,
  PopoverTrigger,
} from "../../../src/react/components/chat/ui/index.ts";
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
  Popover, PopoverTrigger, PopoverContent,
  PopoverTitle, PopoverBody, PopoverFooter, PopoverActions,
} from "veryfront/chat/ui"`;

const compositionTree =
  `Popover              <- Root (owns open state + anchor)
  +-- PopoverTrigger      <- button (asChild merges onto your element)
  +-- PopoverContent      <- floating surface, align="end"; outside-click / Escape dismiss
       +-- PopoverTitle       <- primary heading, 16px medium
       +-- PopoverBody        <- 16px body content, px-5 flex-col gap-4
       +-- PopoverFooter      <- bottom area, no border in the default recipe
            +-- PopoverActions    <- button row, primary left + outline right, left-aligned`;

function PopoverDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Popover"
        lead="Floating overlay anchored to a trigger — in-context confirmations, pickers, detail cards. Basic behavior (outside-click / Escape dismiss); focus-trap and collision-aware positioning are TODO."
      />
      <DocsSection
        title="Confirm action"
        description="In-context confirmation, no modal weight."
      >
        <DocsExampleAuto of={Confirm} />
      </DocsSection>
      <DocsSection
        title="Collaborators"
        description="Title-only, no actions."
      >
        <DocsExampleAuto of={Collaborators} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>
      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Popover"
          props={[
            { name: "open", type: "boolean", description: "Controlled open state" },
            { name: "defaultOpen", type: "boolean", default: "false", description: "Uncontrolled initial state" },
            { name: "onOpenChange", type: "(open) => void", description: "Open-state callback" },
          ]}
        />
        <DocsPropsTable
          component="PopoverContent"
          props={[
            { name: "align", type: "'start' | 'end'", default: "'end'", description: "Horizontal alignment to the trigger" },
          ]}
        />
        <DocsPropsTable
          component="PopoverFooter"
          props={[
            { name: "bordered", type: "boolean", default: "false", description: "Add a top divider (legacy callsites; the default recipe has none)" },
          ]}
        />
        <DocsPropsTable
          component="PopoverActions"
          props={[
            { name: "className", type: "string", description: "Pass `justify-start` to match the left-aligned recipe" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Popover",
  component: Popover,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: PopoverDocsPage } },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Title + body + primary/outline action pair, left-aligned (Studio recipe). */
export const Confirm: Story = {
  name: "Confirm action",
  tags: ["!dev"],
  render: () => (
    <div className="flex h-72 items-start justify-center pt-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary">Open Popover</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[360px]">
          <PopoverTitle>Confirm action</PopoverTitle>
          <PopoverBody>
            <p className="text-base">
              Are you sure you want to proceed? This action cannot be undone.
            </p>
          </PopoverBody>
          <PopoverFooter>
            <PopoverActions className="justify-start">
              <Button variant="primary" size="default">Replace</Button>
              <Button variant="outline" size="default">Cancel</Button>
            </PopoverActions>
          </PopoverFooter>
        </PopoverContent>
      </Popover>
    </div>
  ),
};

/** Title-only popover with body content, no action footer (Studio recipe). */
export const Collaborators: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex h-56 items-start justify-center pt-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary">Share</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[360px]">
          <PopoverTitle>Collaborators</PopoverTitle>
          <PopoverBody>
            <p className="text-base">
              No collaborators yet. Invite someone to get started.
            </p>
          </PopoverBody>
        </PopoverContent>
      </Popover>
    </div>
  ),
};
