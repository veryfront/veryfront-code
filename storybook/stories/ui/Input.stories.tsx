import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function InputDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Input"
        lead="Single-line text field. Themed fill, three size presets, optional leading icon."
      />
      <DocsSection title="Sizes">
        <DocsExampleAuto of={Sizes} />
      </DocsSection>
      <DocsSection title="Invalid" description="Set `data-invalid` to flag errors.">
        <DocsExampleAuto of={Invalid} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={`import { Input } from "veryfront/chat/ui"`} />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Input"
          description="Extends the native <input> props"
          props={[
            {
              name: "size",
              type: "'sm' | 'md' | 'lg'",
              default: "'lg'",
              description: "Height / padding preset",
            },
            {
              name: "icon",
              type: "ReactNode",
              description: "Leading icon inside the field",
            },
            {
              name: "data-invalid",
              type: "boolean",
              description: "Apply the error border",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Input",
  component: Input,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: InputDocsPage } },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sizes: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      <Input size="sm" placeholder="Small" />
      <Input size="md" placeholder="Medium" />
      <Input size="lg" placeholder="Large (default)" />
    </div>
  ),
};
export const Invalid: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-80">
      <Input data-invalid defaultValue="nope@" />
    </div>
  ),
};
