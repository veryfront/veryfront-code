import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Radio,
  RadioField,
  RadioGroup,
} from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function RadioDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Radio"
        lead="A radio built on a native radio input (full a11y). `RadioField` adds a label; `RadioGroup` stacks a set sharing a `name`."
      />
      <DocsSection title="States">
        <DocsExampleAuto of={States} />
      </DocsSection>
      <DocsSection
        title="Group"
        description="Fields sharing a `name` form one choice."
      >
        <DocsExampleAuto of={Group} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode
          code={`import { Radio, RadioField, RadioGroup } from "veryfront/chat/ui"`}
        />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Radio"
          description="Extends native radio input"
          props={[
            { name: "name", type: "string", description: "Shared name groups radios into one choice" },
            { name: "checked / defaultChecked", type: "boolean", description: "Controlled / uncontrolled state" },
            { name: "disabled", type: "boolean", description: "Non-interactive" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Radio",
  component: Radio,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: RadioDocsPage } },
} satisfies Meta<typeof Radio>;

export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-6">
      <Radio name="s" defaultChecked />
      <Radio name="s" />
      <Radio name="d" defaultChecked disabled />
      <Radio name="d2" disabled />
    </div>
  ),
};
export const Group: Story = {
  tags: ["!dev"],
  render: () => (
    <RadioGroup>
      <RadioField name="model" label="Claude Opus" defaultChecked />
      <RadioField
        name="model"
        label="Claude Sonnet"
        description="Faster, lighter."
      />
      <RadioField name="model" label="Claude Haiku" />
    </RadioGroup>
  ),
};
