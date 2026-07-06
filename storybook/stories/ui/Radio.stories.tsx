import type { Meta, StoryObj } from "@storybook/react-vite";
import { Radio } from "../../../src/react/components/ui/index.ts";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";

const importCode = `import { Radio } from "veryfront/ui"`;
const compositionTree = `Radio`;

function RadioDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Radio"
        lead="Single-choice control. Group via shared name."
      />
      <DocsSection
        title="Default"
        description="Group via shared name attribute."
      >
        <DocsExampleAuto of={Default} />
      </DocsSection>
      <DocsSection title="Disabled">
        <DocsExampleAuto of={Disabled} />
      </DocsSection>
      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>
      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>
      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Radio"
          description="Native input[type=radio] with custom styling"
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
  title: "UI/Radio",
  component: Radio,
  tags: ["autodocs"],
  parameters: { layout: "centered", docs: { page: RadioDocsPage } },
} satisfies Meta<typeof Radio>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-3">
      <label
        htmlFor="story-default-selected"
        className="flex items-center gap-2 text-sm"
      >
        <Radio id="story-default-selected" name="story-default" defaultChecked />
        Selected
      </label>
      <label
        htmlFor="story-default-unselected"
        className="flex items-center gap-2 text-sm"
      >
        <Radio id="story-default-unselected" name="story-default" />
        Unselected
      </label>
    </div>
  ),
};

export const Disabled: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="flex flex-col gap-3">
      <label
        htmlFor="story-disabled-selected"
        className="flex items-center gap-2 text-sm"
      >
        <Radio
          id="story-disabled-selected"
          name="story-disabled"
          defaultChecked
          disabled
        />
        Selected (disabled)
      </label>
      <label
        htmlFor="story-disabled-unselected"
        className="flex items-center gap-2 text-sm"
      >
        <Radio id="story-disabled-unselected" name="story-disabled" disabled />
        Unselected (disabled)
      </label>
    </div>
  ),
};
