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

const compositionTree = `AgentPicker  <- Pill (or input-style) trigger showing the selected agent
  +-- Popover  <- portals via Floating so it never clips
  +-- Command  <- searchable list (search appears past 5 agents)
      +-- CommandGroup
          +-- AgentRow  <- Avatar + name, Check on the selection`;

function AgentPickerDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="AgentPicker"
        lead="A Popover + Command combobox for switching the active agent — Avatar rows with a check on the selection."
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
              name: "avatarSrc",
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
};
