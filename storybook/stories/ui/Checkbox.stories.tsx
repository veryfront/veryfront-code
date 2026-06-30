import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Checkbox,
  CheckboxField,
  CheckboxGroup,
} from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function CheckboxDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Checkbox"
        lead="A checkbox built on a native checkbox input (full a11y) with an overlaid check. `CheckboxField` adds a label; `CheckboxGroup` stacks them."
      />
      <DocsSection title="States">
        <DocsExampleAuto of={States} />
      </DocsSection>
      <DocsSection title="Group" description="Fields stacked in a group.">
        <DocsExampleAuto of={Group} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode
          code={`import { Checkbox, CheckboxField, CheckboxGroup } from "veryfront/chat/ui"`}
        />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Checkbox"
          description="Extends native checkbox input"
          props={[
            { name: "checked / defaultChecked", type: "boolean", description: "Controlled / uncontrolled state" },
            { name: "onCheckedChange", type: "(checked) => void", description: "Convenience callback" },
            { name: "disabled", type: "boolean", description: "Non-interactive" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Checkbox",
  component: Checkbox,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: CheckboxDocsPage } },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-6">
      <Checkbox defaultChecked />
      <Checkbox />
      <Checkbox defaultChecked disabled />
      <Checkbox disabled />
    </div>
  ),
};
export const Group: Story = {
  tags: ["!dev"],
  render: () => (
    <CheckboxGroup>
      <CheckboxField label="Production" defaultChecked />
      <CheckboxField
        label="Staging"
        description="Deploy a preview before promoting."
      />
      <CheckboxField label="Local" disabled />
    </CheckboxGroup>
  ),
};
