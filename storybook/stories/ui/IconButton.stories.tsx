import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "../../../src/react/components/chat/ui/index.ts";
import {
  PaperclipIcon,
  PlusIcon,
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

const compositionTree =
  `IconButton  <- Button (icon size) wrapped in a Tooltip
  +-- Tooltip       <- hover/focus label (basic; a11y TODO)
  +-- Button        <- icon-only variant`;

function IconButtonDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="IconButton"
        lead="Icon-only button with a built-in hover tooltip — hover the examples to see it."
      />
      <DocsSection title="Variants">
        <DocsExampleAuto of={Variants} />
      </DocsSection>
      <DocsSection
        title="Disabled"
        description="A disabled IconButton renders without the tooltip."
      >
        <DocsExampleAuto of={Disabled} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={`import { IconButton } from "veryfront/chat/ui"`} />
      </DocsSection>
      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="IconButton"
          description="Extends ButtonProps"
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
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/IconButton",
  component: IconButton,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: IconButtonDocsPage } },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-3 py-6">
      <IconButton tooltip="Add" variant="icon-primary" aria-label="Add">
        <PlusIcon />
      </IconButton>
      <IconButton
        tooltip="Attach a file"
        variant="icon-secondary"
        aria-label="Attach"
      >
        <PaperclipIcon />
      </IconButton>
      <IconButton tooltip="Delete" variant="icon-ghost" aria-label="Delete">
        <TrashIcon />
      </IconButton>
    </div>
  ),
};
export const Disabled: Story = {
  tags: ["!dev"],
  render: () => (
    <IconButton tooltip="Unavailable" disabled aria-label="Unavailable">
      <PlusIcon />
    </IconButton>
  ),
};
