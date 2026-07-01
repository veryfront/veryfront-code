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
  Checkbox,
  Input,
  Label,
} from "../../../src/react/components/chat/ui/index.ts";

const importCode = `import { Label } from "veryfront/chat/ui"`;

function LabelDocsPage() {
  return (
    <DocsPage>
      <DocsHero title="Label" lead="Accessible label for form controls." />

      <DocsSection title="Default" description="14px form label text.">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="Small"
        description="Inline labels next to checkboxes and switches."
      >
        <DocsExampleAuto of={Small} />
      </DocsSection>

      <DocsSection title="With Input">
        <DocsExampleAuto of={WithInput} />
      </DocsSection>

      <DocsSection title="With Checkbox">
        <DocsExampleAuto of={WithCheckbox} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{`Label`}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Label"
          description="Accessible form control label"
          props={[
            {
              name: "size",
              type: "'default' | 'sm' | 'xs'",
              default: "'default'",
              description: "Text size",
            },
            {
              name: "weight",
              type: "'normal' | 'medium'",
              default: "'medium'",
              description: "Font weight",
            },
            {
              name: "htmlFor",
              type: "string",
              description: "Associates the label with a form control by id",
            },
            {
              name: "className",
              type: "string",
              description: "Additional classes",
            },
            {
              name: "children",
              type: "ReactNode",
              description: "Label content",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Label",
  component: Label,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: LabelDocsPage },
  },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Label>Project Name</Label>,
};

export const Small: Story = {
  tags: ["!dev"],
  render: () => <Label size="sm">Environment</Label>,
};

export const WithInput: Story = {
  name: "With Input",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-2 w-64">
      <Label htmlFor="project-name">Project Name</Label>
      <Input id="project-name" placeholder="my-app" />
    </div>
  ),
};

export const WithCheckbox: Story = {
  name: "With Checkbox",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="auto-deploy" />
      <Label htmlFor="auto-deploy" size="sm">
        Auto-deploy on push
      </Label>
    </div>
  ),
};
