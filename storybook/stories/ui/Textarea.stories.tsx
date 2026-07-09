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
  Label,
  Textarea,
} from "../../../src/react/components/ui/index.ts";

const importCode = `import { Textarea } from "veryfront/ui"`;

const compositionTree = `Textarea <- native <textarea> with CVA variants`;

function TextareaDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Textarea"
        lead="Multi-line text input with surface variants and a data-invalid state."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="With Label">
        <DocsExampleAuto of={WithLabel} />
      </DocsSection>

      <DocsSection title="Disabled">
        <DocsExampleAuto of={Disabled} />
      </DocsSection>

      <DocsSection
        title="With Validation"
        description="Set data-invalid for the destructive ring."
      >
        <DocsExampleAuto of={WithValidation} />
      </DocsSection>

      <DocsSection
        title="Custom Height"
        description="Override min-height via className."
      >
        <DocsExampleAuto of={CustomHeight} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Textarea"
          description="Native textarea with CVA variant support"
          props={[
            {
              name: "size",
              type: "'default' | 'sm'",
              default: "'default'",
              description: "Min-height / padding preset",
            },
            {
              name: "data-invalid",
              type: "boolean | 'true' | 'false'",
              description: "Toggles the destructive border for error states",
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
  title: "UI/Textarea",
  component: Textarea,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: TextareaDocsPage },
  },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-80">
      <Textarea placeholder="Your message" />
    </div>
  ),
};

export const WithLabel: Story = {
  name: "With Label",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-2 w-80">
      <Label htmlFor="description">Description</Label>
      <Textarea id="description" placeholder="Describe your project..." />
    </div>
  ),
};

export const Disabled: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-80">
      <Textarea disabled placeholder="Read-only field" />
    </div>
  ),
};

export const WithValidation: Story = {
  name: "With Validation",
  tags: ["!dev"],
  render: () => (
    <div className="w-80">
      <Textarea data-invalid={true} placeholder="Required field" />
    </div>
  ),
};

export const CustomHeight: Story = {
  name: "Custom Height",
  tags: ["!dev"],
  render: () => (
    <div className="w-80 flex flex-col gap-3">
      <Textarea className="min-h-20" placeholder="Short note..." />
      <Textarea className="min-h-40" placeholder="Detailed description..." />
    </div>
  ),
};

export const Small: Story = {
  name: "Small",
  tags: ["!dev"],
  render: () => (
    <div className="w-80">
      <Textarea size="sm" placeholder="Quick note..." />
    </div>
  ),
};
