import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../src/react/components/ui/index.ts";
import { ChevronDownIcon } from "../../../src/react/components/ui/icons/index.ts";
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
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "veryfront/ui"`;

const compositionTree = `Collapsible               <- Root (open state, data-state attribute)
+-- CollapsibleTrigger    <- Toggle button (use asChild to wrap your own element)
+-- CollapsibleContent    <- Animated content region`;

function CollapsibleDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Collapsible"
        lead="Animated show/hide for filter drawers, tool outputs, and settings sections."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="Controlled" description="open / onOpenChange.">
        <DocsExampleAuto of={Controlled} />
      </DocsSection>

      <DocsSection
        title="With Chevron"
        description={
          <>
            Rotate icon via <code>[data-state=open]</code>.
          </>
        }
      >
        <DocsExampleAuto of={WithChevron} />
      </DocsSection>

      <DocsSection title="Nested Content">
        <DocsExampleAuto of={NestedContent} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Collapsible"
          description="Root container — manages open state and exposes data-state attribute"
          props={[
            {
              name: "open",
              type: "boolean",
              description: "Controlled open state",
            },
            {
              name: "defaultOpen",
              type: "boolean",
              default: "false",
              description: "Uncontrolled initial open state",
            },
            {
              name: "onOpenChange",
              type: "(open: boolean) => void",
              description: "Open-state change handler",
            },
            {
              name: "disabled",
              type: "boolean",
              default: "false",
              description: "Disable the trigger",
            },
          ]}
        />
        <DocsPropsTable
          component="CollapsibleTrigger"
          description="Toggle button — sets data-state on the root, use asChild to wrap your own element"
          props={[
            {
              name: "asChild",
              type: "boolean",
              default: "false",
              description: "Merge props onto the child element",
            },
          ]}
        />
        <DocsPropsTable
          component="CollapsibleContent"
          description="Animated content region — uses data-state=open/closed for height animation"
          props={[
            {
              name: "className",
              type: "string",
              description: "Additional classes on the content region",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Collapsible",
  component: Collapsible,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: CollapsibleDocsPage },
  },
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <Collapsible defaultOpen>
      <CollapsibleTrigger asChild>
        <Button variant="secondary" size="default">
          Toggle Settings
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-lg border border-outline-border p-4 text-sm text-foreground">
          Additional settings are visible here when expanded.
        </div>
      </CollapsibleContent>
    </Collapsible>
  ),
};

export const Controlled: Story = {
  tags: ["!dev"],
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="default"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide Filter" : "Show Filter"}
          </Button>
          <span className="text-sm text-foreground">
            State: {open ? "open" : "closed"}
          </span>
        </div>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleContent>
            <div className="rounded-lg border border-outline-border px-4 py-2 text-sm text-foreground">
              Filter input area (controlled by external state)
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  },
};

export const WithChevron: Story = {
  name: "With Chevron",
  tags: ["!dev"],
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium cursor-pointer hover:text-foreground [&[data-state=open]>svg]:rotate-180">
          <ChevronDownIcon className="size-4 transition-transform" />
          Advanced Options
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 pl-6 text-sm text-foreground">
            Hidden content revealed on expand.
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  },
};

export const NestedContent: Story = {
  name: "Nested Content",
  tags: ["!dev"],
  render: () => (
    <div className="space-y-1 w-48">
      <Collapsible defaultOpen>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium cursor-pointer [&[data-state=open]>svg]:rotate-180">
          <ChevronDownIcon className="size-4 transition-transform" />
          General
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pl-6 pt-1 text-sm text-foreground space-y-1">
            <p>Name</p>
            <p>Description</p>
          </div>
        </CollapsibleContent>
      </Collapsible>
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium cursor-pointer [&[data-state=open]>svg]:rotate-180">
          <ChevronDownIcon className="size-4 transition-transform" />
          Advanced
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pl-6 pt-1 text-sm text-foreground space-y-1">
            <p>Timeout</p>
            <p>Retries</p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  ),
};
