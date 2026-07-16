import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { AgentPicker } from "veryfront/chat";
import type { AgentOption } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const agents: AgentOption[] = [
  { id: "inbox-helper", name: "Inbox Helper" },
  { id: "lawyer", name: "Lawyer Agent" },
  { id: "ux", name: "UX Agent" },
  { id: "researcher", name: "Research Agent" },
];

const importCode = `import { AgentPicker } from "veryfront/chat"`;

const compositionTree =
  `AgentPicker            <- render-or-compose: preset with props, or compose sub-parts
  +-- AgentPicker.Trigger  <- the pill / input-style combobox button
  +-- AgentPicker.Content  <- the popover surface (wraps a Command shell)
  +-- AgentPicker.Search   <- optional search input
  +-- AgentPicker.List     <- the scrollable Command list region
  +-- AgentPicker.Item     <- a single agent row (Avatar + name + check)

Preset props (no children): agents / sections, value / onValueChange,
onManage / onCreate, inputStyle, isLoading, className.`;

const composedCode = `import { AgentPicker } from "veryfront/chat";

// Pass children to recompose the menu from sub-parts. Each reads the shared
// selection + open state via useAgentPicker(); className merges last.
<AgentPicker agents={agents} value={value} onValueChange={setValue}>
  <AgentPicker.Trigger />
  <AgentPicker.Content>
    <AgentPicker.Search />
    <AgentPicker.List>
      {agents.map((agent) => (
        <AgentPicker.Item key={agent.id} agent={agent} />
      ))}
    </AgentPicker.List>
  </AgentPicker.Content>
</AgentPicker>`;

function AgentPickerDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="AgentPicker"
        lead="A Popover and Command combobox for switching the active agent, with Avatar rows and a check on the selection."
      />

      <DocsSection
        title="Default"
        description="Click the pill to open the list and pick an agent."
      >
        <DocsExampleAuto of={Default} />
      </DocsSection>

      <DocsSection
        title="Input style"
        description="`inputStyle` renders the trigger as a form field (bordered, input background) instead of a pill."
      >
        <DocsExampleAuto of={InputStyle} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection
        title="Compose"
        description="Pass children to recompose the menu from `AgentPicker.Trigger` / `Content` / `Search` / `List` / `Item`. Each sub-part reads the shared selection + open state via `useAgentPicker()`; `className` merges last. Omit children to keep the data-driven preset."
      >
        <DocsExampleAuto of={Composed} />
        <DocsCode code={composedCode} />
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="AgentPicker"
          description="Agent switcher combobox"
          props={[
            {
              name: "agents",
              type: "AgentOption[]",
              description: "Agents shown in the default group",
            },
            {
              name: "value",
              type: "string",
              description: "Selected agent id",
            },
            {
              name: "onValueChange",
              type: "(id: string) => void",
              description: "Called with the chosen agent id",
            },
            {
              name: "sections",
              type: "AgentPickerSection[]",
              description: "Extra labelled groups below the default agents",
            },
            {
              name: "onManage",
              type: "() => void",
              description: "Adds a Manage Agents action row when provided",
            },
            {
              name: "onCreate",
              type: "() => void",
              description: "Adds a Create Agent action row when provided",
            },
            {
              name: "inputStyle",
              type: "boolean",
              description: "Render the trigger as a form field, not a pill",
            },
            {
              name: "isLoading",
              type: "boolean",
              description: "Show skeleton rows while agents load",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the trigger",
            },
          ]}
        />
        <DocsPropsTable
          component="AgentOption"
          description="A selectable agent entry"
          props={[
            {
              name: "id",
              type: "string",
              description: "Stable identifier used as the selection value",
            },
            {
              name: "name",
              type: "string",
              description: "Display name (also the search keyword)",
            },
            {
              name: "avatarUrl",
              type: "string",
              description: "Avatar image URL; initials shown when absent",
            },
            {
              name: "disabled",
              type: "boolean",
              description: "Dims the row and blocks selection",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/AgentPicker",
  component: AgentPicker,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: AgentPickerDocsPage },
  },
} satisfies Meta<typeof AgentPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["!dev"],
  render: () => {
    const [value, setValue] = React.useState(agents[0].id);
    return (
      <StoryFrame maxWidth="420px">
        <ReviewSurface label="AgentPicker">
          <AgentPicker
            agents={agents}
            value={value}
            onValueChange={setValue}
          />
        </ReviewSurface>
      </StoryFrame>
    );
  },
  parameters: {
    docs: {
      source: {
        code: `<AgentPicker
  agents={agents}
  value={value}
  onValueChange={setValue}
/>`,
      },
    },
  },
};

export const InputStyle: Story = {
  tags: ["!dev"],
  render: () => {
    const [value, setValue] = React.useState(agents[1].id);
    return (
      <StoryFrame maxWidth="420px">
        <ReviewSurface label="Input style">
          <AgentPicker
            agents={agents}
            value={value}
            onValueChange={setValue}
            inputStyle
          />
        </ReviewSurface>
      </StoryFrame>
    );
  },
  parameters: {
    docs: {
      source: {
        code: `<AgentPicker
  agents={agents}
  value={value}
  onValueChange={setValue}
  inputStyle
/>`,
      },
    },
  },
};

export const Composed: Story = {
  tags: ["!dev"],
  render: () => {
    const [value, setValue] = React.useState(agents[0].id);
    return (
      <StoryFrame maxWidth="420px">
        <ReviewSurface label="Composed">
          <AgentPicker agents={agents} value={value} onValueChange={setValue}>
            <AgentPicker.Trigger />
            <AgentPicker.Content>
              <AgentPicker.Search />
              <AgentPicker.List>
                {agents.map((agent) => (
                  <AgentPicker.Item key={agent.id} agent={agent} />
                ))}
              </AgentPicker.List>
            </AgentPicker.Content>
          </AgentPicker>
        </ReviewSurface>
      </StoryFrame>
    );
  },
  parameters: {
    docs: { source: { code: composedCode } },
  },
};
