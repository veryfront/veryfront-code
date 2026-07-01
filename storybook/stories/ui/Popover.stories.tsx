import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Button,
  Checkbox,
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

const importCode = `import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverBody,
  PopoverFooter,
  PopoverActions,
} from "veryfront/chat/ui"`;

const compositionTree = `Popover                    <- Root
+-- PopoverTrigger         <- toggles the popover
+-- PopoverContent         <- panel, align="end" by default
    +-- PopoverTitle       <- Primary heading, 16px medium
    +-- PopoverBody        <- 16px body content, px-5 flex-col gap-4
    +-- PopoverFooter      <- Bottom area, no border in the default recipe
        +-- PopoverActions <- Button row, primary left + outline right, left-aligned`;

const responsivePatternCode = `// Desktop/mobile responsive pattern
<ResponsiveSwitch
  desktop={
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button>Share</Button>
      </PopoverTrigger>
      <PopoverContent>
        <PopoverTitle>Collaborators</PopoverTitle>
        <PopoverBody>
          {/* collaborator list */}
        </PopoverBody>
      </PopoverContent>
    </Popover>
  }
  mobile={
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerContent>
        <DrawerHeader title="Collaborators" />
        <DrawerBody>
          {/* collaborator list */}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  }
/>`;

function PopoverDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Popover"
        lead="Floating overlay anchored to a trigger. Desktop counterpart to Drawer."
      />

      <DocsSection title="Confirm action" description="In-context confirmation, no modal weight.">
        <DocsExampleAuto of={Confirm} />
      </DocsSection>

      <DocsSection title="Publish to" description="Target picker with a primary action.">
        <DocsExampleAuto of={Publish} />
      </DocsSection>

      <DocsSection title="Collaborators" description="Title-only, no actions.">
        <DocsExampleAuto of={Collaborators} />
      </DocsSection>

      <DocsSection
        title="Real-world Patterns"
        description={
          <>
            Desktop half of a responsive pair with <code>Drawer</code>.
          </>
        }
      >
        <DocsCode code={responsivePatternCode} />
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
          description="Root"
          props={[
            { name: "open", type: "boolean", description: "Controlled open state" },
            { name: "defaultOpen", type: "boolean", default: "false", description: "Uncontrolled initial open state" },
            { name: "onOpenChange", type: "(open) => void", description: "Open-state change handler" },
          ]}
        />
        <DocsPropsTable
          component="PopoverContent"
          description="Panel. Defaults optimised for panel-style popovers."
          props={[
            { name: "align", type: "'start' | 'end'", default: "'end'", description: "Horizontal alignment relative to the trigger" },
            { name: "className", type: "string", description: "Additional classes" },
          ]}
        />
        <DocsPropsTable
          component="PopoverTitle"
          description="Primary heading — 16px medium."
          props={[{ name: "children", type: "ReactNode", description: "Heading content" }]}
        />
        <DocsPropsTable
          component="PopoverBody"
          description="Content area — flex-col with gap-4. Use 16px body text inside."
          props={[{ name: "children", type: "ReactNode", description: "Body content" }]}
        />
        <DocsPropsTable
          component="PopoverFooter"
          description="Bottom action area — no border in the recipe. The bordered prop exists for legacy callsites."
          props={[{ name: "bordered", type: "boolean", default: "false", description: "Adds a top divider" }]}
        />
        <DocsPropsTable
          component="PopoverActions"
          description={"Button row — pass className='justify-start' to match the left-aligned recipe."}
          props={[{ name: "className", type: "string", description: "Additional classes (e.g. justify-start)" }]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Popover",
  component: Popover,
  subcomponents: { PopoverTrigger, PopoverContent, PopoverTitle, PopoverBody, PopoverFooter, PopoverActions },
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: PopoverDocsPage },
  },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

/* -------------------------------------------------------------------------------------------------
 * Confirm action — title + body + primary/outline action pair, left-aligned
 * -------------------------------------------------------------------------------------------------*/

export const Confirm: Story = {
  name: "Confirm action",
  tags: ["!dev"],
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary">Open Popover</Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px]">
        <PopoverTitle>Confirm action</PopoverTitle>
        <PopoverBody>
          <p className="text-base">Are you sure you want to proceed? This action cannot be undone.</p>
        </PopoverBody>
        <PopoverFooter>
          <PopoverActions className="justify-start">
            <Button variant="primary" size="default">
              Replace
            </Button>
            <Button variant="outline" size="default">
              Cancel
            </Button>
          </PopoverActions>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  ),
};

/* -------------------------------------------------------------------------------------------------
 * Publish to — checkbox list (filled checkboxes for the on-card surface),
 * primary Deploy left + outline Close right, no footer border
 * -------------------------------------------------------------------------------------------------*/

export const Publish: Story = {
  name: "Publish to",
  tags: ["!dev"],
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button>Publish</Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px]">
        <PopoverTitle>Publish to</PopoverTitle>
        <PopoverBody>
          <label htmlFor="publish-production" className="flex items-center gap-2.5 text-base">
            <Checkbox id="publish-production" defaultChecked />
            Production
          </label>
          <label htmlFor="publish-staging" className="flex items-center gap-2.5 text-base">
            <Checkbox id="publish-staging" />
            Staging
          </label>
        </PopoverBody>
        <PopoverFooter>
          <PopoverActions className="justify-start">
            <Button variant="primary" size="default">
              Deploy
            </Button>
            <Button variant="outline" size="default">
              Close
            </Button>
          </PopoverActions>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  ),
};

/* -------------------------------------------------------------------------------------------------
 * Collaborators — title-only popover with body content, no action footer.
 * Same 24px title rhythm as Confirm/Publish.
 * -------------------------------------------------------------------------------------------------*/

export const Collaborators: Story = {
  tags: ["!dev"],
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary">Share</Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px]">
        <PopoverTitle>Collaborators</PopoverTitle>
        <PopoverBody>
          <p className="text-base">No collaborators yet. Invite someone to get started.</p>
        </PopoverBody>
      </PopoverContent>
    </Popover>
  ),
};
