import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  Checkbox,
  Label,
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

const importCode = `import { Checkbox } from "veryfront/chat/ui"`;

function CheckboxDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Checkbox"
        lead="Boolean toggle for forms and multi-select."
      />
      <DocsSection title="Default">
        <DocsExampleAuto of={Default} />
      </DocsSection>
      <DocsSection title="Checked">
        <DocsExampleAuto of={Checked} />
      </DocsSection>
      <DocsSection title="Disabled">
        <DocsExampleAuto of={Disabled} />
      </DocsSection>
      <DocsSection
        title="With Label"
        description="Always pair via matching id / htmlFor."
      >
        <DocsExampleAuto of={WithLabel} />
      </DocsSection>
      <DocsSection title="Environment Selector">
        <DocsExampleAuto of={EnvironmentSelector} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>
      <DocsSection title="Composition">
        <DocsComposition>Checkbox</DocsComposition>
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Checkbox"
          description="Boolean toggle control (native checkbox input)"
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

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Checkbox />,
};

export const Checked: Story = {
  tags: ["!dev"],
  render: () => <Checkbox defaultChecked />,
};

export const Disabled: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex items-center gap-3">
      <Checkbox disabled />
      <Checkbox disabled defaultChecked />
    </div>
  ),
  parameters: { docs: { source: { code: `<Checkbox disabled />` } } },
};

export const WithLabel: Story = {
  name: "With Label",
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

export const EnvironmentSelector: Story = {
  name: "Environment Selector",
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Checkbox id="env-production" defaultChecked />
        <Label htmlFor="env-production" size="sm">Production</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="env-staging" />
        <Label htmlFor="env-staging" size="sm">Staging</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="env-preview" />
        <Label htmlFor="env-preview" size="sm">Preview</Label>
      </div>
    </div>
  ),
};
