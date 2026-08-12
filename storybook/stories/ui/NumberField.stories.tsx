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
import { NumberField } from "../../../src/react/components/ui/index.ts";

const importCode = `import { NumberField } from "veryfront/ui"`;

function NumberFieldDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="NumberField"
        lead="A numeric input that clamps to a range and steps with the arrow keys."
      />

      <DocsSection title="Default" description="Type a number, or press ArrowUp / ArrowDown to step by 1.">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="Clamped range" description="min / max bound the value; stepping stops at the edges.">
        <DocsExampleAuto of={Clamped} />
      </DocsSection>

      <DocsSection title="Custom step" description="step sets the increment and rounds typed input.">
        <DocsExampleAuto of={CustomStep} />
      </DocsSection>

      <DocsSection title="Controlled" description="Drive the value with value + onValueChange (null when cleared).">
        <DocsExampleAuto of={Controlled} />
      </DocsSection>

      <DocsSection title="Disabled">
        <DocsExampleAuto of={Disabled} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>NumberField</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="NumberField"
          description="Numeric input with clamping and keyboard stepping"
          props={[
            {
              name: "value",
              type: "number | null",
              description: "Controlled value (null = empty); pair with onValueChange",
            },
            {
              name: "defaultValue",
              type: "number",
              description: "Initial value when uncontrolled",
            },
            {
              name: "onValueChange",
              type: "(value: number | null) => void",
              description: "Fires with the next value (null when cleared)",
            },
            { name: "min", type: "number", description: "Smallest allowed value" },
            { name: "max", type: "number", description: "Largest allowed value" },
            { name: "step", type: "number", default: "1", description: "Increment for stepping" },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/NumberField",
  component: NumberField,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: NumberFieldDocsPage },
  },
} satisfies Meta<typeof NumberField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-40">
      <NumberField defaultValue={1} aria-label="Amount" />
    </div>
  ),
};

export const Clamped: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-40">
      <NumberField defaultValue={5} min={0} max={10} aria-label="Quantity (0–10)" />
    </div>
  ),
};

export const CustomStep: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-40">
      <NumberField defaultValue={0} step={5} aria-label="Multiples of 5" />
    </div>
  ),
};

export const Controlled: Story = {
  tags: ["!dev"],
  render: () => {
    const [value, setValue] = useState<number | null>(3);
    return (
      <div className="w-40">
        <NumberField value={value} onValueChange={setValue} min={0} aria-label="Controlled" />
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">value: {String(value)}</p>
      </div>
    );
  },
};

export const Disabled: Story = {
  tags: ["!dev"],
  render: () => (
    <div className="w-40">
      <NumberField defaultValue={1} disabled aria-label="Disabled" />
    </div>
  ),
};
