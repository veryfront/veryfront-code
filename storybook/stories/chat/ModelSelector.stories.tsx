import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { ModelSelector } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { modelOptions } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode = `import { ModelSelector } from "veryfront/chat"`;

const compositionTree = `ModelSelector  <- trigger button (shows selected label)
  +-- Listbox  <- fixed-position popover, opens upward
  +-- Group  <- one per provider when models have a provider
  +-- Option  <- label, optional badge + description`;

function ModelSelectorDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ModelSelector"
        lead="A WAI-ARIA listbox for switching models at runtime — keyboard-navigable, grouped by provider, and positioned above its trigger."
      />

      <DocsSection
        title="Default"
        description="A closed selector; click or use the keyboard to open the listbox and pick a model."
      >
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="Disabled"
        description="`disabled` dims the trigger and prevents opening the listbox."
      >
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
          component="ModelSelector"
          description="Runtime model switcher"
          props={[
            {
              name: "models",
              type: "ModelOption[]",
              description: "Available models to choose from",
            },
            {
              name: "value",
              type: "string",
              description: "Selected model value (undefined = agent default)",
            },
            {
              name: "onChange",
              type: "(model: string) => void",
              description: "Called with the selected model value",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names",
            },
            {
              name: "disabled",
              type: "boolean",
              description: "Disables the trigger",
            },
          ]}
        />
        <DocsPropsTable
          component="ModelOption"
          description="A selectable model entry"
          props={[
            {
              name: "value",
              type: "string",
              description: '"provider/model" string (e.g. "openai/gpt-4o")',
            },
            {
              name: "label",
              type: "string",
              description: "Display label (e.g. \"GPT-4o\")",
            },
            {
              name: "provider",
              type: "string",
              description: "Provider name used for grouping",
            },
            {
              name: "description",
              type: "string",
              description: "Short description shown beneath the label",
            },
            {
              name: "badge",
              type: "string",
              description: 'Badge text (e.g. "Local", "New")',
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/ModelSelector",
  component: ModelSelector,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ModelSelectorDocsPage },
  },
} satisfies Meta<typeof ModelSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => {
    const [model, setModel] = React.useState(modelOptions[0]?.value);

    return (
      <StoryFrame maxWidth="420px">
        <ReviewSurface label="Closed">
          <ModelSelector
            models={modelOptions}
            value={model}
            onChange={setModel}
          />
        </ReviewSurface>
      </StoryFrame>
    );
  },
};

export const Disabled: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="420px">
      <ReviewSurface label="Disabled">
        <ModelSelector
          models={modelOptions}
          value={modelOptions[1]?.value}
          onChange={() => undefined}
          disabled
        />
      </ReviewSurface>
    </StoryFrame>
  ),
};
