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
import { ToggleGroup, ToggleGroupItem } from "../../../src/react/components/ui/index.ts";

const importCode = `import { ToggleGroup, ToggleGroupItem } from "veryfront/ui"`;

function ToggleGroupDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ToggleGroup"
        lead="A set of toggles with shared selection: single (segmented control) or multiple."
      />

      <DocsSection title="Single" description="type='single': one value at a time, like a segmented control.">
        <DocsExampleAuto of={Single} />
      </DocsSection>

      <DocsSection title="Multiple" description="type='multiple': an independent set; selection is an array.">
        <DocsExampleAuto of={Multiple} />
      </DocsSection>

      <DocsSection title="Disabled" description="Disable the whole group.">
        <DocsExampleAuto of={Disabled} />
      </DocsSection>

      <DocsSection title="Controlled" description="Drive value + onValueChange yourself.">
        <DocsExampleAuto of={Controlled} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{"ToggleGroup > ToggleGroupItem"}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ToggleGroup"
          description="A group of toggles with shared selection"
          props={[
            {
              name: "type",
              type: "'single' | 'multiple'",
              default: "'single'",
              description: "Single value (segmented) or a multi-select set",
            },
            {
              name: "value",
              type: "string | string[]",
              description: "Controlled selection (pair with onValueChange)",
            },
            {
              name: "defaultValue",
              type: "string | string[]",
              description: "Initial selection when uncontrolled",
            },
            {
              name: "onValueChange",
              type: "((value: string) => void) | ((value: string[]) => void)",
              description: "Fires with a string in single mode or a string array in multiple mode",
            },
            {
              name: "disabled",
              type: "boolean",
              description: "Disable every item",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/ToggleGroup",
  component: ToggleGroup,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: ToggleGroupDocsPage },
  },
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {
  tags: ["!dev"],
  render: () => (
    <ToggleGroup type="single" defaultValue="center" aria-label="Text align">
      <ToggleGroupItem value="left">Left</ToggleGroupItem>
      <ToggleGroupItem value="center">Center</ToggleGroupItem>
      <ToggleGroupItem value="right">Right</ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const Multiple: Story = {
  tags: ["!dev"],
  render: () => (
    <ToggleGroup type="multiple" defaultValue={["bold"]} aria-label="Formatting">
      <ToggleGroupItem value="bold">B</ToggleGroupItem>
      <ToggleGroupItem value="italic">I</ToggleGroupItem>
      <ToggleGroupItem value="underline">U</ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const Disabled: Story = {
  tags: ["!dev"],
  render: () => (
    <ToggleGroup type="single" defaultValue="left" disabled aria-label="Text align">
      <ToggleGroupItem value="left">Left</ToggleGroupItem>
      <ToggleGroupItem value="center">Center</ToggleGroupItem>
      <ToggleGroupItem value="right">Right</ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const Controlled: Story = {
  tags: ["!dev"],
  render: () => {
    const [value, setValue] = useState("grid");
    return (
      <ToggleGroup type="single" value={value} onValueChange={setValue} aria-label="View">
        <ToggleGroupItem value="list">List</ToggleGroupItem>
        <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
      </ToggleGroup>
    );
  },
};
