import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  InferenceBadge,
  SkillBadge,
  ToolCallCard,
  ToolStatusBadge,
} from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import { completedToolPart, erroredToolPart } from "../fixtures/chat";
import { ReviewSurface, StoryFrame } from "../support/StoryFrame";

const importCode =
  `import { InferenceBadge, SkillBadge, ToolCallCard, ToolStatusBadge } from "veryfront/chat"`;

const compositionTree = `ToolCallCard  <- expandable card for one tool invocation
  +-- header  <- tool name + ToolStatusBadge + chevron
  +-- Parameters  <- highlighted JSON input
  +-- Result  <- JSON or auto table output
ToolStatusBadge  <- pill mapping tool state to label + icon
SkillBadge  <- compact pill for load_skill / reference / script tools
InferenceBadge  <- "Running locally" indicator for non-cloud inference`;

function ToolCallCardDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ToolCallCard"
        lead="Renders a single tool invocation — parameters, result, and status — plus the standalone status, skill, and inference badges it composes."
      />

      <DocsSection
        title="Completed"
        description="A finished tool call expands to show its parameters and result, with a 'Completed' status badge."
      >
        <DocsExampleAuto of={Completed} />
      </DocsSection>

      <DocsSection
        title="Error"
        description="When a tool fails, the card surfaces the error text alongside an 'Error' status badge."
      >
        <DocsExampleAuto of={Error} />
      </DocsSection>

      <DocsSection
        title="Badges"
        description="`ToolStatusBadge`, `SkillBadge`, and `InferenceBadge` are exported individually for use outside the card."
      >
        <DocsExampleAuto of={Badges} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ToolCallCard"
          description="Expandable card for a single tool invocation"
          props={[
            {
              name: "tool",
              type: "ChatToolPart | ChatDynamicToolPart",
              description:
                "The tool part to render (name, state, input, output, errorText)",
            },
          ]}
        />
        <DocsPropsTable
          component="ToolStatusBadge"
          description="Pill mapping a tool state to a label and icon"
          props={[
            {
              name: "state",
              type: "string",
              description:
                "Tool state, e.g. input-available, output-available, output-error",
            },
          ]}
        />
        <DocsPropsTable
          component="SkillBadge"
          description="Compact badge for skill tool calls"
          props={[
            {
              name: "tool",
              type: "ChatToolPart | ChatDynamicToolPart",
              description:
                "Skill tool part (load_skill, load_skill_reference, execute_skill_script)",
            },
            {
              name: "className",
              type: "string",
              description: "Additional class names for the badge",
            },
          ]}
        />
        <DocsPropsTable
          component="InferenceBadge"
          description="Indicator for non-cloud inference (renders null for cloud)"
          props={[
            {
              name: "inferenceMode",
              type: "InferenceMode",
              description: "Inference mode; renders 'Running locally' unless 'cloud'",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/ToolCallCard",
  component: ToolCallCard,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ToolCallCardDocsPage },
  },
} satisfies Meta<typeof ToolCallCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Completed: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <ToolCallCard tool={completedToolPart} />
    </StoryFrame>
  ),
};

export const Error: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <ToolCallCard tool={erroredToolPart} />
    </StoryFrame>
  ),
};

export const Badges: Story = {
  tags: ["!dev"],
  render: () => (
    <StoryFrame maxWidth="720px">
      <ReviewSurface label="Status and mode badges">
        <div className="flex flex-wrap gap-2">
          <ToolStatusBadge state="input-available" />
          <ToolStatusBadge state="output-available" />
          <ToolStatusBadge state="output-error" />
          <SkillBadge
            tool={{
              type: "tool-load_skill",
              toolCallId: "skill-1",
              toolName: "load_skill",
              state: "output-available",
              input: { skillId: "frontend-ui-ux" },
            }}
          />
          <InferenceBadge inferenceMode="server-local" />
        </div>
      </ReviewSurface>
    </StoryFrame>
  ),
};
