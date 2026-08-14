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
import { Toggle } from "../../../src/react/components/ui/index.ts";

const importCode = `import { Toggle } from "veryfront/ui"`;

function ToggleDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="Toggle"
        lead="A two-state pressed button - on / off - with data-state styling."
      />

      <DocsSection title="Default" description="Uncontrolled - select to toggle pressed state.">
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection title="Pressed" description="Start pressed with defaultPressed.">
        <DocsExampleAuto of={Pressed} />
      </DocsSection>

      <DocsSection title="Disabled" description="Non-interactive, dimmed.">
        <DocsExampleAuto of={Disabled} />
      </DocsSection>

      <DocsSection title="Controlled" description="Drive pressed via state + onPressedChange.">
        <DocsExampleAuto of={Controlled} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>Toggle</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="Toggle"
          description="Two-state pressed button"
          props={[
            {
              name: "pressed",
              type: "boolean",
              description: "Controlled pressed state (pair with onPressedChange)",
            },
            {
              name: "defaultPressed",
              type: "boolean",
              default: "false",
              description: "Initial pressed state when uncontrolled",
            },
            {
              name: "onPressedChange",
              type: "(pressed: boolean) => void",
              description: "Fires with the next pressed state",
            },
            {
              name: "asChild",
              type: "boolean",
              default: "false",
              description: "Graft the toggle behaviour onto your own element",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "UI/Toggle",
  component: Toggle,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    docs: { page: ToggleDocsPage },
  },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => <Toggle aria-label="Bold">B</Toggle>,
};

export const Pressed: Story = {
  tags: ["!dev"],
  render: () => (
    <Toggle defaultPressed aria-label="Italic">
      I
    </Toggle>
  ),
};

export const Disabled: Story = {
  tags: ["!dev"],
  render: () => (
    <Toggle disabled aria-label="Underline">
      U
    </Toggle>
  ),
};

export const Controlled: Story = {
  tags: ["!dev"],
  render: () => {
    const [on, setOn] = useState(false);
    return (
      <Toggle pressed={on} onPressedChange={setOn} aria-label="Mute">
        {on ? "Muted" : "Live"}
      </Toggle>
    );
  },
};
