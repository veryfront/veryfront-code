import type { Meta, StoryObj } from "@storybook/react-vite";
import { Label } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function LabelDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Label"
        lead="Form control label. Medium weight by default; `sm` / `xs` sizes."
      />
      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>
      <DocsSection title="Sizes & weights">
        <DocsExampleAuto of={Variants} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={`import { Label } from "veryfront/chat/ui"`} />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Label"
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
  parameters: { layout: "centered", docs: { page: LabelDocsPage } },
} satisfies Meta<typeof Label>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Label>Message</Label>,
};
export const Variants: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-2">
      <Label size="default">Default (sm, medium)</Label>
      <Label size="xs">Extra small</Label>
      <Label weight="normal">Normal weight</Label>
    </div>
  ),
};
