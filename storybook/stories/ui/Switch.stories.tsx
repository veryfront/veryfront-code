import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Switch,
  SwitchField,
} from "../../../src/react/components/chat/ui/index.ts";
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
  `import { Switch, SwitchField } from "veryfront/chat/ui"`;

const compositionTree = `Switch         <- Bare toggle control
SwitchField    <- Label row with embedded Switch`;

function SwitchDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Switch"
        lead="Binary toggle. SwitchField wraps it with a label row for settings forms."
      />

      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="All Sizes">
        <DocsExampleAuto of={AllSizes} />
      </DocsSection>

      <DocsSection title="SwitchField With Label">
        <DocsExampleAuto of={SwitchFieldWithLabel} />
      </DocsSection>

      <DocsSection title="With Description">
        <DocsExampleAuto of={WithDescription} />
      </DocsSection>

      <DocsSection title="Disabled">
        <DocsExampleAuto of={Disabled} />
      </DocsSection>

      <DocsSection title="Settings List">
        <DocsExampleAuto of={SettingsList} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Switch"
          description="Bare toggle control"
          props={[
            {
              name: "size",
              type: "'sm' | 'md' | 'lg'",
              default: "'md'",
              description: "Track / thumb size",
            },
            {
              name: "checked / defaultChecked",
              type: "boolean",
              description: "Controlled / uncontrolled state",
            },
            {
              name: "onCheckedChange",
              type: "(checked: boolean) => void",
              description: "Convenience change callback",
            },
          ]}
        />
        <DocsPropsTable
          component="SwitchField"
          description="Label row with embedded Switch"
          props={[
            { name: "label", type: "string", description: "Row label" },
            {
              name: "description",
              type: "string",
              description: "Secondary line under the label",
            },
            {
              name: "disabled",
              type: "boolean",
              default: "false",
              description: "Disable the whole field",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/UI/Switch",
  component: Switch,
  subcomponents: { SwitchField },
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: SwitchDocsPage },
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Switch size="sm" />,
};

export const AllSizes: Story = {
  name: "All Sizes",
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-6">
      <Switch size="sm" defaultChecked />
      <Switch size="md" defaultChecked />
      <Switch size="lg" defaultChecked />
    </div>
  ),
};

export const SwitchFieldWithLabel: Story = {
  name: "SwitchField With Label",
  tags: ["!dev"],
  render: () => (
    <div className="w-80">
      <SwitchField label="Email Notifications" />
    </div>
  ),
};

export const WithDescription: Story = {
  name: "With Description",
  tags: ["!dev"],
  render: () => (
    <div className="w-80">
      <SwitchField
        label="Public Environment"
        description="Anyone with the URL can access"
      />
    </div>
  ),
};

export const Disabled: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-80">
      <SwitchField label="Template Project" disabled />
    </div>
  ),
};

export const SettingsList: Story = {
  name: "Settings List",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-4 w-80">
      <SwitchField label="Email Notifications" defaultChecked />
      <SwitchField
        label="Public Environment"
        description="Anyone with the URL can access"
      />
      <SwitchField label="Auto-deploy on push" defaultChecked />
      <SwitchField label="Template Project" disabled />
    </div>
  ),
};
