import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { Slider } from "../../../src/react/components/ui/index.ts";

const importCode = `import { Slider } from "veryfront/ui"`;

function SliderDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Slider"
        lead="Pick a number from a range by dragging the thumb or using the arrow keys."
      />

      <DocsSection title="Default" description="0-100, uncontrolled.">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="Custom range & step" description="min / max / step bound and quantize the value.">
        <DocsExampleAuto of={RangeAndStep} />
      </DocsSection>

      <DocsSection title="Controlled" description="Drive the value with value + onValueChange.">
        <DocsExampleAuto of={Controlled} />
      </DocsSection>

      <DocsSection title="Disabled">
        <DocsExampleAuto of={Disabled} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>Slider</DocsComposition>
      </DocsSection>

      <DocsSection title="API reference">
        <DocsPropsTable
          component="Slider"
          description="Range slider (native input, restyled)"
          props={[
            {
              name: "value",
              type: "number",
              description: "Controlled value (pair with onValueChange)",
            },
            {
              name: "defaultValue",
              type: "number",
              description: "Initial value when uncontrolled",
            },
            {
              name: "onValueChange",
              type: "(value: number) => void",
              description: "Fires with the next value as the thumb moves",
            },
            { name: "min", type: "number", default: "0", description: "Lowest value" },
            { name: "max", type: "number", default: "100", description: "Highest value" },
            { name: "step", type: "number", default: "1", description: "Snap granularity" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Slider",
  component: Slider,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: SliderDocsPage },
  },
} satisfies Meta<typeof Slider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-64">
      <Slider defaultValue={50} aria-label="Volume" />
    </div>
  ),
};

export const RangeAndStep: Story = {
  name: "Custom range & step",
  tags: ["!dev"],
  render: () => (
    <div className="w-64">
      <Slider defaultValue={20} min={16} max={30} step={0.5} aria-label="Temperature" />
    </div>
  ),
};

export const Controlled: Story = {
  tags: ["!dev"],
  render: () => {
    const [value, setValue] = useState(30);
    return (
      <div className="w-64">
        <Slider value={value} onValueChange={setValue} aria-label="Controlled" />
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">value: {value}</p>
      </div>
    );
  },
};

export const Disabled: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-64">
      <Slider defaultValue={40} disabled aria-label="Disabled" />
    </div>
  ),
};
