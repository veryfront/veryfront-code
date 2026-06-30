import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Switch,
  SwitchField,
} from "../../../src/react/components/chat/ui/index.ts";
import {
  DocsCode,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

function SwitchDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Switch"
        lead="A toggle built on a native switch input for full keyboard / form a11y. Three sizes; `SwitchField` adds a label + description."
      />
      <DocsSection title="Sizes">
        <DocsExampleAuto of={Sizes} />
      </DocsSection>
      <DocsSection title="Field" description="Label-left, switch-right.">
        <DocsExampleAuto of={Field} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode
          code={`import { Switch, SwitchField } from "veryfront/chat/ui"`}
        />
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Switch"
          description="Extends native checkbox input"
          props={[
            { name: "size", type: "'sm' | 'md' | 'lg'", default: "'md'", description: "Track / thumb size" },
            { name: "checked / defaultChecked", type: "boolean", description: "Controlled / uncontrolled state" },
            { name: "onCheckedChange", type: "(checked) => void", description: "Convenience callback" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Switch",
  component: Switch,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: SwitchDocsPage } },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Sizes: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-6">
      <Switch size="sm" defaultChecked />
      <Switch size="md" defaultChecked />
      <Switch size="lg" defaultChecked />
      <Switch size="md" />
      <Switch size="md" defaultChecked disabled />
    </div>
  ),
};
export const Field: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-[340px]">
      <SwitchField
        label="Stream responses"
        description="Show tokens as they're generated."
        defaultChecked
      />
    </div>
  ),
};
