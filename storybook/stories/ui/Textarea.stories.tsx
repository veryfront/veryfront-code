import type { Meta, StoryObj } from "@storybook/react-vite";
import { Textarea } from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function TextareaDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Textarea"
        lead="Multi-line text input. Non-resizing, themed, with two size presets."
      />
      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>
      <DocsSection title="Small">
        <DocsExampleAuto of={Small} />
      </DocsSection>
      <DocsSection title="Invalid" description="Set `data-invalid` to flag errors.">
        <DocsExampleAuto of={Invalid} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={`import { Textarea } from "veryfront/chat/ui"`} />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Textarea"
          description="Extends the native <textarea> props"
          props={[
            {
              name: "size",
              type: "'default' | 'sm'",
              default: "'default'",
              description: "Min-height and padding preset",
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
  title: "Chat/UI/Textarea",
  component: Textarea,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: TextareaDocsPage } },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-96">
      <Textarea placeholder="Send a message..." />
    </div>
  ),
};
export const Small: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-96">
      <Textarea size="sm" placeholder="Add a note..." />
    </div>
  ),
};
export const Invalid: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-96">
      <Textarea data-invalid defaultValue="Too short" />
    </div>
  ),
};
