import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../../src/react/components/chat/ui/index.ts";
import { ChevronDownIcon } from "../../../src/react/components/chat/icons/index.ts";
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
  `import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "veryfront/chat/ui"`;

const compositionTree =
  `Collapsible          <- owns open state (controlled or uncontrolled)
  +-- CollapsibleTrigger  <- toggles open; asChild merges onto your element
  +-- CollapsibleContent  <- shown only while open`;

function CollapsibleDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Collapsible"
        lead="Show/hide a region behind a trigger. Used for tool-call cards and details rows."
      />
      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
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
          props={[
            { name: "open", type: "boolean", description: "Controlled open state" },
            { name: "defaultOpen", type: "boolean", default: "false", description: "Uncontrolled initial state" },
            { name: "onOpenChange", type: "(open) => void", description: "Open-state callback" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Collapsible",
  component: Collapsible,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: CollapsibleDocsPage } },
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <Collapsible defaultOpen className="w-80">
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm">
          <ChevronDownIcon />
          Tool details
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-md border border-[var(--outline-border)] p-3 text-sm text-[var(--foreground)]">
          The collapsed region — arguments, results, logs, etc.
        </div>
      </CollapsibleContent>
    </Collapsible>
  ),
};
