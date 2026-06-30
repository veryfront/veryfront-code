import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Button,
  LoadingButton,
} from "../../../src/react/components/chat/ui/index.ts";
import { PlusIcon } from "../../../src/react/components/chat/icons/index.ts";
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
  `import { Button, LoadingButton } from "veryfront/chat/ui"`;

const compositionTree =
  `Button         <- <button>, or a Radix-style Slot when asChild
LoadingButton  <- Button + opacity pulse + aria-busy + disabled while pending`;

function ButtonDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Button"
        lead="Action element with variants, sizes, icon-only forms, and a loading state."
      />

      <DocsSection title="Primary">
        <DocsExampleAuto of={Primary} />
      </DocsSection>
      <DocsSection title="Secondary">
        <DocsExampleAuto of={Secondary} />
      </DocsSection>
      <DocsSection title="Tertiary">
        <DocsExampleAuto of={Tertiary} />
      </DocsSection>
      <DocsSection title="Outline" description="Cancel / dismiss in dialogs.">
        <DocsExampleAuto of={Outline} />
      </DocsSection>
      <DocsSection title="Ghost">
        <DocsExampleAuto of={Ghost} />
      </DocsSection>
      <DocsSection
        title="Destructive"
        description="Irreversible actions only."
      >
        <DocsExampleAuto of={Destructive} />
      </DocsSection>
      <DocsSection title="Link">
        <DocsExampleAuto of={Link} />
      </DocsSection>
      <DocsSection title="Sizes">
        <DocsExampleAuto of={Sizes} />
      </DocsSection>
      <DocsSection
        title="Icon"
        description="Icon-only variants — always pair with an `aria-label`."
      >
        <DocsExampleAuto of={Icon} />
      </DocsSection>
      <DocsSection
        title="Loading"
        description="`LoadingButton` keeps the label, sets `aria-busy`, disables clicks, and applies a subtle opacity pulse."
      >
        <DocsExampleAuto of={Loading} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>
      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Button"
          description="Action element"
          props={[
            {
              name: "variant",
              type:
                "'primary' | 'secondary' | 'tertiary' | 'outline' | 'destructive' | 'link' | 'ghost' | 'text' | 'icon-primary' | 'icon-ghost' | 'icon-secondary' | 'icon-tertiary'",
              default: "'primary'",
              description: "Visual style",
            },
            {
              name: "size",
              type:
                "'sm' | 'default' | 'lg' | 'icon-sm' | 'icon-default' | 'icon-lg' | 'icon-xl'",
              default: "'default'",
              description: "Height / padding preset",
            },
            {
              name: "on",
              type: "'chrome' | 'card'",
              default: "'chrome'",
              description: "Surface the button sits on (drives hover pairing)",
            },
            {
              name: "asChild",
              type: "boolean",
              default: "false",
              description: "Render as a Slot, merging props onto the child",
            },
            {
              name: "animateIcon",
              type: "boolean",
              default: "false",
              description: "Slide the icon right on hover",
            },
          ]}
        />
        <DocsPropsTable
          component="LoadingButton"
          description="Button that pulses while pending and blocks double-submits"
          props={[
            {
              name: "isLoading",
              type: "boolean",
              description:
                "Pending state — opacity pulse, aria-busy, disabled",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Button",
  component: Button,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: ButtonDocsPage },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  tags: ["!dev"],
  render: () => <Button>Get started</Button>,
};
export const Secondary: Story = {
  tags: ["!dev"],
  render: () => <Button variant="secondary">Learn more</Button>,
};
export const Tertiary: Story = {
  tags: ["!dev"],
  render: () => <Button variant="tertiary">View details</Button>,
};
export const Outline: Story = {
  tags: ["!dev"],
  render: () => <Button variant="outline">Cancel</Button>,
};
export const Ghost: Story = {
  tags: ["!dev"],
  render: () => <Button variant="ghost">Ghost</Button>,
};
export const Destructive: Story = {
  tags: ["!dev"],
  render: () => <Button variant="destructive">Delete</Button>,
};
export const Link: Story = {
  tags: ["!dev"],
  render: () => <Button variant="link">Read more</Button>,
};
export const Sizes: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};
export const Icon: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-3">
      <Button variant="icon-primary" aria-label="Add">
        <PlusIcon />
      </Button>
      <Button variant="icon-secondary" aria-label="Add">
        <PlusIcon />
      </Button>
      <Button variant="icon-ghost" aria-label="Add">
        <PlusIcon />
      </Button>
    </div>
  ),
};
export const Loading: Story = {
  tags: ["!dev"],
  render: () => <LoadingButton isLoading>Saving</LoadingButton>,
};
