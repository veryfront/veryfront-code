import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToolCall } from "veryfront/chat";
import {
  DocsCode,
  DocsComposition,
  DocsExampleAuto,
  DocsHero,
  DocsPage,
  DocsPropsTable,
  DocsSection,
} from "../../.storybook/docs";
import {
  completedToolPart,
  erroredToolPart,
  loadedSkillToolPart,
  loadingSkillToolPart,
  runningToolPart,
} from "../fixtures/chat";
import { StoryFrame } from "../support/StoryFrame";

const importCode = `import { ToolCall } from "veryfront/chat"`;

const compositionTree = `ToolCall  <- one tool invocation (card, or compact row for skills)
  +-- header       <- tool name + status badge + chevron
  +-- Parameters   <- highlighted JSON input
  +-- Result       <- JSON or auto table output
  +-- Error        <- Alert (error) with the failure text
  +-- compact      <- single-line row (icon + label) for skill tools`;

function ToolCallDocsPage() {
  return (
    <DocsPage>
      <DocsHero
        title="ToolCall"
        lead="An expandable card for a single tool invocation — parameters, result or error, and a status badge that reflects the tool's lifecycle."
      />

      <DocsSection
        title="Running"
        description="While a tool is executing, the card shows a 'Running' status and its parameters."
      >
        <DocsExampleAuto of={Running} />
      </DocsSection>

      <DocsSection
        title="Completed"
        description="A finished tool call expands to show its parameters and result, with a 'Completed' status."
      >
        <DocsExampleAuto of={Completed} />
      </DocsSection>

      <DocsSection
        title="Error"
        description="When a tool fails, the card surfaces the failure text in an error Alert."
      >
        <DocsExampleAuto of={Error} />
      </DocsSection>

      <DocsSection
        title="Skill (compact)"
        description={'Skill tools (`load_skill`) render as a compact single-line row instead of a card — a Sparkles icon while loading, a check once loaded. This is the `variant="compact"` presentation, applied automatically for skill parts.'}
      >
        <DocsExampleAuto of={SkillLoading} />
        <DocsExampleAuto of={SkillLoaded} />
      </DocsSection>

      <DocsSection title="Import">
        <DocsCode code={importCode} />
      </DocsSection>

      <DocsSection title="Composition">
        <DocsComposition>{compositionTree}</DocsComposition>
      </DocsSection>

      <DocsSection title="API Reference">
        <DocsPropsTable
          component="ToolCall"
          description="Expandable card for a single tool invocation"
          props={[
            {
              name: "tool",
              type: "ChatToolPart | ChatDynamicToolPart",
              description:
                "The tool part to render (name, state, input, output, errorText)",
            },
            {
              name: "variant",
              type: '"card" | "compact"',
              description:
                "Presentation only. Defaults to compact for skill tools, card otherwise.",
            },
          ]}
        />
      </DocsSection>
    </DocsPage>
  );
}

const meta = {
  title: "Chat/Components/ToolCall",
  component: ToolCall,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { page: ToolCallDocsPage },
  },
} satisfies Meta<typeof ToolCall>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { ToolCall } from "veryfront/chat";

<ToolCall
  tool={{
    type: "tool-search_docs",
    toolCallId: "tool-search-docs-running",
    toolName: "search_docs",
    state: "input-available",
    input: { query: "agent run persistence" },
  }}
/>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ToolCall tool={runningToolPart} />
    </StoryFrame>
  ),
};

export const Completed: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { ToolCall } from "veryfront/chat";

<ToolCall
  tool={{
    type: "tool-search_docs",
    toolCallId: "tool-search-docs-1",
    toolName: "search_docs",
    state: "output-available",
    input: { query: "agent run persistence" },
    output: [
      { title: "Runs", confidence: "high" },
      { title: "Agent guide", confidence: "medium" },
    ],
  }}
/>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ToolCall tool={completedToolPart} />
    </StoryFrame>
  ),
};

export const Error: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { ToolCall } from "veryfront/chat";

<ToolCall
  tool={{
    type: "tool-trigger_deploy",
    toolCallId: "tool-trigger-deploy-1",
    toolName: "trigger_deploy",
    state: "output-error",
    input: { project: "demo" },
    errorText: "Missing deploy token",
  }}
/>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ToolCall tool={erroredToolPart} />
    </StoryFrame>
  ),
};

export const SkillLoading: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { ToolCall } from "veryfront/chat";

<ToolCall
  variant="compact"
  tool={{
    type: "tool-load_skill",
    toolCallId: "tool-load-skill-loading",
    toolName: "load_skill",
    state: "input-available",
    input: { skillId: "support-escalation" },
  }}
/>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ToolCall variant="compact" tool={loadingSkillToolPart} />
    </StoryFrame>
  ),
};

export const SkillLoaded: Story = {
  tags: ["!dev"],
  parameters: {
    docs: {
      source: {
        code: `import { ToolCall } from "veryfront/chat";

<ToolCall
  variant="compact"
  tool={{
    type: "tool-load_skill",
    toolCallId: "tool-load-skill-1",
    toolName: "load_skill",
    state: "output-available",
    input: { skillId: "support-escalation" },
    output: { loaded: true },
  }}
/>`,
      },
    },
  },
  render: () => (
    <StoryFrame maxWidth="720px">
      <ToolCall variant="compact" tool={loadedSkillToolPart} />
    </StoryFrame>
  ),
};
