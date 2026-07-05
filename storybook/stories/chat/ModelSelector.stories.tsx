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

const compositionTree =
  `ModelSelector             <- render-or-compose: preset with props, or compose sub-parts
  +-- ModelSelector.Trigger   <- the pill / icon combobox button
  +-- ModelSelector.Content   <- the popover surface (wraps a Command shell)
  +-- ModelSelector.List      <- the scrollable Command list region
  +-- ModelSelector.Item      <- a single model row (logo + label + badge + check)

Preset props (no children): models, value / onChange, variant,
renderTrigger / renderRow (back-compat), disabled, className.`;

const composedCode = `import { ModelSelector } from "veryfront/chat";

// Pass children to recompose the menu from sub-parts. Each reads the shared
// selection + open state via useModelSelector(); className merges last.
<ModelSelector models={models} value={value} onChange={setModel}>
  <ModelSelector.Trigger variant="pill" />
  <ModelSelector.Content showSearch>
    <ModelSelector.List>
      {models.map((model) => (
        <ModelSelector.Item key={model.value} model={model} />
      ))}
    </ModelSelector.List>
  </ModelSelector.Content>
</ModelSelector>`;

function ModelSelectorDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ModelSelector"
        lead="A Popover + Command combobox for switching models — grouped by provider with real models.dev logos. The `icon` trigger (provider logo only) matches Studio's desktop picker; `pill` adds the label."
      />

      <DocsSection
        title="Default (icon)"
        description="The icon trigger shows just the selected provider's logo, like Studio's desktop picker. Click to open the grouped model list."
      >
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="Pill"
        description="The `pill` variant adds the model label + chevron next to the logo."
      >
        <DocsExampleAuto of={Pill} />
      </DocsSection>

      <DocsSection
        title="Disabled"
        description="`disabled` dims the trigger and prevents opening the list."
      >
        <DocsExampleAuto of={Disabled} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection
        title="Compose"
        description="Pass children to recompose the menu from `ModelSelector.Trigger` / `Content` / `List` / `Item`. Each sub-part reads the shared selection + open state via `useModelSelector()`; `className` merges last. Omit children to keep the data-driven preset."
      >
        <DocsExampleAuto of={Composed} />
        <DocsCode code={composedCode} />
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
              name: "variant",
              type: '"pill" | "icon"',
              default: '"pill"',
              description:
                "Trigger style: icon (provider logo only) or pill (logo + label + chevron)",
            },
            {
              name: "renderTrigger",
              type: "(opts: { model?: ModelOption; open: boolean }) => ReactNode",
              description: "Replace the default pill/icon trigger",
            },
            {
              name: "renderRow",
              type:
                "(opts: { model: ModelOption; selected: boolean; onSelect: () => void }) => ReactNode",
              description: "Replace the default row renderer",
            },
            {
              name: "disabled",
              type: "boolean",
              description: "Disables the trigger",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the trigger",
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
              description: 'Display label (e.g. "GPT-4o")',
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
  parameters: {
    docs: {
      source: {
        code: `import { ModelSelector } from "veryfront/chat";

const [model, setModel] = React.useState("anthropic/claude-sonnet-4");

<ModelSelector
  variant="icon"
  models={modelOptions}
  value={model}
  onChange={setModel}
/>`,
      },
    },
  },
  render: () => {
    const [model, setModel] = React.useState(modelOptions[0]?.value);

    return (
      <StoryFrame maxWidth="420px">
        <ReviewSurface label="Icon trigger">
          <ModelSelector
            variant="icon"
            models={modelOptions}
            value={model}
            onChange={setModel}
          />
        </ReviewSurface>
      </StoryFrame>
    );
  },
};

export const Pill: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { ModelSelector } from "veryfront/chat";

const [model, setModel] = React.useState("anthropic/claude-sonnet-4");

<ModelSelector models={modelOptions} value={model} onChange={setModel} />`,
      },
    },
  },
  render: () => {
    const [model, setModel] = React.useState(modelOptions[0]?.value);

    return (
      <StoryFrame maxWidth="420px">
        <ReviewSurface label="Pill trigger">
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
  parameters: {
    docs: {
      source: {
        code: `import { ModelSelector } from "veryfront/chat";

<ModelSelector
  models={modelOptions}
  value="openai/gpt-4.1"
  onChange={setModel}
  disabled
/>`,
      },
    },
  },
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

export const Composed: Story = {
  tags: ["!dev"],
  parameters: {
    docs: { source: { code: composedCode } },
  },
  render: () => {
    const [model, setModel] = React.useState(modelOptions[0]?.value);
    return (
      <StoryFrame maxWidth="420px">
        <ReviewSurface label="Composed">
          <ModelSelector models={modelOptions} value={model} onChange={setModel}>
            <ModelSelector.Trigger variant="pill" />
            <ModelSelector.Content showSearch>
              <ModelSelector.List>
                {modelOptions.map((m) => (
                  <ModelSelector.Item key={m.value} model={m} />
                ))}
              </ModelSelector.List>
            </ModelSelector.Content>
          </ModelSelector>
        </ReviewSurface>
      </StoryFrame>
    );
  },
};
